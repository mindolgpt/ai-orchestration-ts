import * as fs from 'fs/promises'
import * as path from 'path'
import {
  SddSpec,
  SddDesign,
  SddPipelineState,
  SddSpecInput,
  DesignEvidence,
  TechnicalKickoffPacket,
} from './types'
import { FileSpecStore, createSpec, writeSpecFiles } from './spec'
import {
  FileDesignStore,
  createDesign,
  writeDesignFile,
  readDesignFile,
  buildKickoffPacket,
  formatDefaultDesignBody,
} from './design'
import { generateTasks } from './tasks'
import {
  computeDesignRevision,
  computeEvidenceFingerprint,
  computeProductFingerprint,
} from './revision'
import { validateDesignReadiness, validateTaskReadiness, selfReview } from './validator'
import { ApprovalGate } from '@/orchestrator/approval'
import { buildEnrichedDesignBody } from '@/sdd/from-wiki'
import type { ObsidianVault } from '@/knowledge/vault'
import type { SemanticSearch } from '@/knowledge/search'

export interface SddPipelineDeps {
  /** Optional vault + search to enrich designs with semantic wiki citations. */
  vault?: ObsidianVault
  search?: SemanticSearch
  /**
   * When true, approveSpec/approveDesign self-complete the approval gate
   * immediately (trustedLocal resolve) instead of blocking on waitFor().
   * Enabled by AIO_SDD_AUTO_APPROVE=1 env var — preserves the human gate by
   * default while letting fully-automated MCP flows (e.g. Cursor agents)
   * progress past spec→design→tasks without access to server stderr
   * confirm_code. The pipeline still flips spec.status to 'approved', so the
   * downstream design gate (`spec.status === 'approved'`) is honored.
   */
  autoApprove?: boolean
}

export class SddPipeline {
  private specStore: FileSpecStore
  private designStore: FileDesignStore
  private approval: ApprovalGate
  private baseDir: string
  private vault?: ObsidianVault
  private search?: SemanticSearch
  private autoApprove: boolean

  constructor(baseDir: string, approval: ApprovalGate, deps?: SddPipelineDeps) {
    this.baseDir = baseDir
    this.specStore = new FileSpecStore(baseDir)
    this.designStore = new FileDesignStore(baseDir)
    this.approval = approval
    this.vault = deps?.vault
    this.search = deps?.search
    this.autoApprove = deps?.autoApprove ?? process.env.AIO_SDD_AUTO_APPROVE === '1'
  }

  /** Query the wiki for pages relevant to the spec (best-effort, non-fatal). */
  private async fetchWikiExcerpts(
    spec: SddSpec
  ): Promise<Array<{ title: string; excerpt: string }>> {
    if (!this.vault || !this.search) return []
    try {
      // Cheap guard: skip search (and native vector-store init) unless the wiki
      // has substantive, indexed pages. A lone seeded "*-overview.md" from the
      // bootstrap wiki phase is not real knowledge and is not indexed, so we
      // exclude it — this avoids loading the embedder/FAISS on greenfield
      // pipelines where there is nothing to cite (and dodges native init cost).
      const notes = (await this.vault.listNotes('wiki/')).filter(
        (p) =>
          !p.endsWith('/index.md') &&
          !p.endsWith('/log.md') &&
          p !== 'wiki/index.md' &&
          p !== 'wiki/log.md' &&
          !/-overview\.md$/.test(p)
      )
      if (notes.length === 0) return []
      const { queryWiki } = await import('@/knowledge/wiki-ops')
      const query = [
        spec.title,
        spec.productContext,
        ...(spec.requirements || []).map((r) => r.description),
      ]
        .filter(Boolean)
        .join('. ')
        .slice(0, 400)
      const res = await queryWiki(this.vault, this.search, query, 6, { response_mode: 'snippets' })
      return (res.pages || [])
        .map((p) => ({ title: p.title, excerpt: p.snippet || '' }))
        .filter((p) => p.excerpt)
    } catch {
      return []
    }
  }

  async createSpec(input: SddSpecInput): Promise<SddPipelineState> {
    const spec = createSpec(input, this.baseDir)
    await writeSpecFiles(spec, input)
    await this.specStore.save(spec)
    return { currentStage: 'spec', spec, error: undefined }
  }

  /**
   * Approve a spec.
   *
   * Two resolution paths:
   *  - `opts.confirmCode` provided (e.g. MCP caller passing the code from
   *    server stderr): the approval is resolved immediately through
   *    `approval.resolve(..., { confirmCode })` — no human-wait loop, no
   *    300s timeout.
   *  - No `confirmCode`: falls back to `approval.waitFor`, which blocks until
   *    another process resolves the request via `approvals.json` (or until the
   *    300s timeout). This preserves the human-in-the-loop gate for CLI flows.
   */
  /**
   * Decide how the just-created approval request is resolved:
   *  1) confirmCode provided -> call resolve() with that code (proves the
   *     caller saw the server stderr code; checked against confirmHash).
   *  2) autoApprove (AIO_SDD_AUTO_APPROVE=1) -> call resolve() with
   *     trustedLocal=true, no code needed.
   *  3) neither -> waitFor() (human-in-the-loop, ~300s timeout if nobody
   *     resolves via approvals.json).
   */
  private async resolveOrWait(approvalId: string, resolver: string, confirmCode?: string) {
    if (confirmCode !== undefined) {
      return this.approval.resolve(approvalId, true, resolver, { confirmCode })
    }
    if (this.autoApprove) {
      return this.approval.resolve(approvalId, true, resolver, {
        trustedLocal: true,
      })
    }
    return this.approval.waitFor(approvalId)
  }

  async approveSpec(
    specId: string,
    resolver = 'human',
    opts?: { confirmCode?: string }
  ): Promise<SddPipelineState> {
    const spec = await this.specStore.get(specId)
    if (!spec) return { currentStage: 'spec', error: `Spec ${specId} not found` }

    const approvalReq = await this.approval.request(
      `approve_spec:${specId}`,
      `Approve spec ${spec.title}`,
      'medium'
    )
    // Self-complete path:
    //  1) opts.confirmCode (MCP caller passed code from stderr) -> resolve with code
    //  2) autoApprove (AIO_SDD_AUTO_APPROVE=1) -> resolve trustedLocal
    //  3) otherwise -> waitFor (human-in-the-loop, may time out after 300s)
    const resolved = await this.resolveOrWait(approvalReq.id, resolver, opts?.confirmCode)
    if ('error' in resolved) return { currentStage: 'spec', spec, error: resolved.error }

    if (resolved.status === 'approved') {
      spec.status = 'approved'
      spec.approvedAt = Date.now()
      spec.approvedBy = resolver
      await this.specStore.save(spec)
    }

    return { currentStage: 'spec', spec }
  }

  async createDesign(specId: string): Promise<SddPipelineState> {
    const spec = await this.specStore.get(specId)
    if (!spec) return { currentStage: 'spec', error: `Spec ${specId} not found` }
    if (spec.status !== 'approved')
      return { currentStage: 'spec', spec, error: 'Spec must be approved before design' }

    const design = createDesign(spec, this.baseDir)
    buildKickoffPacket(spec)
    let body = formatDefaultDesignBody(spec)
    try {
      const asIsPath = path.join(this.baseDir, 'vault', 'wiki', 'as-is-codebase.md')
      let asIsMarkdown: string | undefined
      try {
        asIsMarkdown = await fs.readFile(asIsPath, 'utf-8')
      } catch {
        /* optional */
      }
      const wikiExcerpts = await this.fetchWikiExcerpts(spec)
      body = buildEnrichedDesignBody({
        projectRoot: this.baseDir,
        spec,
        requirements: spec.requirements || [],
        asIsMarkdown,
        wikiExcerpts,
      })
    } catch {
      /* keep default body */
    }
    await writeDesignFile(design, body)
    await this.designStore.save(design)

    return { currentStage: 'design', spec, design }
  }

  async approveDesign(
    designId: string,
    evidence: DesignEvidence[],
    kickoff?: TechnicalKickoffPacket,
    resolver = 'human',
    opts?: { confirmCode?: string }
  ): Promise<SddPipelineState> {
    const design = await this.designStore.get(designId)
    if (!design) return { currentStage: 'design', error: `Design ${designId} not found` }

    const spec = await this.specStore.get(design.specId)

    // Auto-evidence path: when no evidence is supplied and autoApprove is on
    // (AIO_SDD_AUTO_APPROVE=1, used by automated MCP flows without access to
    // server stderr confirm_code), synthesize a confirmed-path evidence item
    // anchored to the design doc — mirroring autoApproveDesignAndGenerateTasks.
    // This lets the public sdd_approve_design tool complete a greenfield
    // design approval without a human evidence-collection round, while the
    // human/evidence-backed path (explicit evidence array) is unchanged.
    let effectiveEvidence = evidence
    if (
      (!evidence || evidence.length === 0) &&
      this.autoApprove &&
      spec &&
      spec.status === 'approved'
    ) {
      effectiveEvidence = [
        {
          id: `auto-${design.id}`,
          proof: 'confirmed-path',
          sourceFile: design.systemDesignPath || 'system_design.md',
          commit: 'auto',
          symbol: 'system_design',
          lineRange: [1, 1],
          finding: 'auto-generated design approved via autoApprove (sdd_approve_design)',
        },
      ]
    }

    const review = selfReview(effectiveEvidence, kickoff)
    if (review.verdict !== 'PASS') {
      return {
        currentStage: 'design',
        spec,
        design,
        error: `Self review: ${review.verdict} - ${review.blockers.join(', ')}`,
      }
    }

    const readiness = validateDesignReadiness(design, spec, effectiveEvidence, kickoff)
    if (!readiness.isReady) {
      return {
        currentStage: 'design',
        spec,
        design,
        error: `Readiness score ${readiness.score}: ${readiness.criticalFindings.join(', ')}`,
      }
    }

    const approvalReq = await this.approval.request(
      `approve_design:${designId}`,
      `Approve design for spec ${spec?.title}`,
      'high'
    )
    // Self-complete path: same precedence as approveSpec.
    const resolved = await this.resolveOrWait(approvalReq.id, resolver, opts?.confirmCode)
    if ('error' in resolved) return { currentStage: 'design', spec, design, error: resolved.error }

    if (resolved.status === 'approved') {
      const body = await readDesignFile(design)
      const productFp = computeProductFingerprint(spec?.revision || '', spec?.revision || '')
      const evidenceFp = computeEvidenceFingerprint(
        effectiveEvidence.map((e) => e.id),
        Object.fromEntries(effectiveEvidence.map((e) => [e.id, e.commit]))
      )
      const newRevision = computeDesignRevision(body, productFp, evidenceFp)

      design.status = 'approved'
      design.designRevision = newRevision
      design.approvedRevision = newRevision
      design.approvedAt = Date.now()
      design.approvedBy = resolver
      design.productFingerprint = productFp
      design.evidenceFingerprint = evidenceFp
      await this.designStore.save(design)
    }

    return { currentStage: 'design', spec, design }
  }

  /**
   * Automated (non-interactive) design approval + task generation for
   * greenfield pipelines (bootstrap_product auto_approve_spec). Bypasses the
   * human approval gate and synthesizes minimal design-anchored evidence so the
   * evidence-gated readiness checks pass, then generates tasks.md. Use only in
   * trusted local automation — human flows should use approveDesign + evidence.
   */
  async autoApproveDesignAndGenerateTasks(designId: string): Promise<SddPipelineState> {
    const design = await this.designStore.get(designId)
    if (!design) return { currentStage: 'design', error: `Design ${designId} not found` }
    const spec = await this.specStore.get(design.specId)
    if (!spec || spec.status !== 'approved') {
      return { currentStage: 'design', spec, design, error: 'Spec must be approved first' }
    }

    // Synthesize confirmed-path evidence anchored to the generated design doc so
    // selfReview/readiness gates pass without a human evidence-collection round.
    const evidence: DesignEvidence[] = [
      {
        id: `auto-${design.id}`,
        proof: 'confirmed-path',
        sourceFile: design.systemDesignPath || 'system_design.md',
        commit: 'auto',
        symbol: 'system_design',
        lineRange: [1, 1],
        finding: 'auto-generated design approved by bootstrap_product automation',
      },
    ]

    const review = selfReview(evidence, undefined)
    if (review.verdict === 'BLOCKED') {
      return {
        currentStage: 'design',
        spec,
        design,
        error: `Self review blocked: ${review.blockers.join(', ')}`,
      }
    }

    const body = await readDesignFile(design)
    const productFp = computeProductFingerprint(spec.revision || '', spec.revision || '')
    const evidenceFp = computeEvidenceFingerprint(
      evidence.map((e) => e.id),
      Object.fromEntries(evidence.map((e) => [e.id, e.commit]))
    )
    const newRevision = computeDesignRevision(body, productFp, evidenceFp)

    design.status = 'approved'
    design.designRevision = newRevision
    design.approvedRevision = newRevision
    design.approvedAt = Date.now()
    design.approvedBy = 'auto'
    design.productFingerprint = productFp
    design.evidenceFingerprint = evidenceFp
    await this.designStore.save(design)

    return this.generateTasks(design.id)
  }

  async generateTasks(designId: string): Promise<SddPipelineState> {
    const design = await this.designStore.get(designId)
    if (!design) return { currentStage: 'design', error: `Design ${designId} not found` }

    const spec = await this.specStore.get(design.specId)

    if (design.status !== 'approved' || !design.approvedRevision) {
      return {
        currentStage: 'design',
        spec,
        design,
        error: 'Design must be approved before task generation',
      }
    }

    if (design.designRevision !== design.approvedRevision) {
      return {
        currentStage: 'design',
        spec,
        design,
        error: 'Design revision mismatch: regenerate design',
      }
    }

    const tasks = await generateTasks(design, spec, this.baseDir)

    const readiness = validateTaskReadiness(tasks, design, spec)
    if (!readiness.isReady) {
      return {
        currentStage: 'tasks',
        spec,
        design,
        tasks,
        error: `Task readiness: ${readiness.score} - ${readiness.criticalFindings.join(', ')}`,
      }
    }

    return { currentStage: 'tasks', spec, design, tasks }
  }

  async getState(): Promise<SddPipelineState[]> {
    const specs = await this.specStore.list()
    const designs = await this.designStore.list()
    return specs.map((spec) => {
      const relevantDesign = designs.find((d) => d.specId === spec.id)
      return {
        currentStage: relevantDesign
          ? relevantDesign.status === 'approved'
            ? 'tasks'
            : 'design'
          : 'spec',
        spec,
        design: relevantDesign,
      }
    })
  }

  async getSpec(id: string): Promise<SddSpec | undefined> {
    return this.specStore.get(id)
  }

  async getDesign(id: string): Promise<SddDesign | undefined> {
    return this.designStore.get(id)
  }
}
