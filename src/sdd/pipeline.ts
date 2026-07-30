import * as fs from 'fs/promises'
import * as path from 'path'
import { SddSpec, SddDesign, SddPipelineState, SddSpecInput } from './types'
import { FileSpecStore, createSpec, writeSpecFiles } from './spec'
import {
  FileDesignStore,
  createDesign as createDesignObj,
  writeDesignFile,
  buildKickoffPacket,
  formatDefaultDesignBody,
} from './design'
import { generateTasks } from './tasks'
import {
  computeDesignRevision,
  computeEvidenceFingerprint,
  computeProductFingerprint,
} from './revision'
import { buildEnrichedDesignBody, writeAcceptanceJson } from '@/sdd/from-wiki'
import type { ObsidianVault } from '@/knowledge/vault'
import type { SemanticSearch } from '@/knowledge/search'

export interface SddPipelineDeps {
  /** Optional vault + search to enrich designs with semantic wiki citations. */
  vault?: ObsidianVault
  search?: SemanticSearch
}

export class SddPipeline {
  private specStore: FileSpecStore
  private designStore: FileDesignStore
  private baseDir: string
  private vault?: ObsidianVault
  private search?: SemanticSearch

  constructor(baseDir: string, deps?: SddPipelineDeps) {
    this.baseDir = baseDir
    this.specStore = new FileSpecStore(baseDir)
    this.designStore = new FileDesignStore(baseDir)
    this.vault = deps?.vault
    this.search = deps?.search
  }

  /** Query the wiki for pages relevant to the spec (best-effort, non-fatal). */
  private async fetchWikiExcerpts(
    spec: SddSpec
  ): Promise<Array<{ title: string; excerpt: string }>> {
    if (!this.vault || !this.search) return []
    try {
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

  private async buildEnrichedBody(spec: SddSpec): Promise<string | undefined> {
    try {
      const asIsPath = path.join(this.baseDir, 'vault', 'wiki', 'as-is-codebase.md')
      let asIsMarkdown: string | undefined
      try {
        asIsMarkdown = await fs.readFile(asIsPath, 'utf-8')
      } catch {
        /* optional */
      }
      const wikiExcerpts = await this.fetchWikiExcerpts(spec)
      if (!wikiExcerpts.length && !asIsMarkdown) return undefined
      return buildEnrichedDesignBody({
        projectRoot: this.baseDir,
        spec,
        requirements: spec.requirements || [],
        asIsMarkdown,
        wikiExcerpts,
      })
    } catch {
      return undefined
    }
  }

  async createSpec(input: SddSpecInput): Promise<SddPipelineState> {
    const spec = createSpec(input, this.baseDir)
    spec.status = 'approved'
    spec.approvedAt = Date.now()
    spec.approvedBy = 'auto'
    await writeSpecFiles(spec, input)
    await this.specStore.save(spec)
    // Write acceptance.json for report_acceptance MCP tool.
    await writeAcceptanceJson(this.baseDir, spec.id, spec.requirements || []).catch(() => {
      /* non-fatal */
    })
    return { currentStage: 'spec', spec, error: undefined }
  }

  async createDesign(specId: string): Promise<SddPipelineState> {
    const spec = await this.specStore.get(specId)
    if (!spec) return { currentStage: 'spec', error: `Spec ${specId} not found` }

    const design = createDesignObj(spec, this.baseDir)
    buildKickoffPacket(spec)
    let body = formatDefaultDesignBody(spec)
    try {
      const enriched = await this.buildEnrichedBody(spec)
      if (enriched) body = enriched
    } catch {
      /* keep default body */
    }
    await writeDesignFile(design, body)

    // Auto-approve design: compute all revision / fingerprint fields immediately.
    const productFp = computeProductFingerprint(spec.revision || '', spec.revision || '')
    const evidenceFp = computeEvidenceFingerprint([], {})
    const newRevision = computeDesignRevision(body, productFp, evidenceFp)
    design.status = 'approved'
    design.designRevision = newRevision
    design.approvedRevision = newRevision
    design.approvedAt = Date.now()
    design.approvedBy = 'auto'
    design.productFingerprint = productFp
    design.evidenceFingerprint = evidenceFp
    await this.designStore.save(design)

    return { currentStage: 'design', spec, design }
  }

  async generateTasks(designId: string): Promise<SddPipelineState> {
    const design = await this.designStore.get(designId)
    if (!design) return { currentStage: 'design', error: `Design ${designId} not found` }

    const spec = await this.specStore.get(design.specId)

    // Revisions must be consistent (design file changed after creation).
    if (design.approvedRevision && design.designRevision !== design.approvedRevision) {
      return {
        currentStage: 'design',
        spec,
        design,
        error: 'Design revision mismatch: regenerate design',
      }
    }

    const tasks = await generateTasks(design, spec, this.baseDir)

    return { currentStage: 'tasks', spec, design, tasks }
  }

  async getState(): Promise<SddPipelineState[]> {
    const specs = await this.specStore.list()
    const designs = await this.designStore.list()
    return specs.map((spec) => {
      const relevantDesign = designs.find((d) => d.specId === spec.id)
      return {
        currentStage: relevantDesign
          ? relevantDesign.approvedRevision &&
            relevantDesign.designRevision === relevantDesign.approvedRevision
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
