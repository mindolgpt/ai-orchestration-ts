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
} from './design'
import { generateTasks } from './tasks'
import {
  computeDesignRevision,
  computeEvidenceFingerprint,
  computeProductFingerprint,
} from './revision'
import { validateDesignReadiness, validateTaskReadiness, selfReview } from './validator'
import { ApprovalGate } from '@/orchestrator/approval'

export class SddPipeline {
  private specStore: FileSpecStore
  private designStore: FileDesignStore
  private approval: ApprovalGate
  private baseDir: string

  constructor(baseDir: string, approval: ApprovalGate) {
    this.baseDir = baseDir
    this.specStore = new FileSpecStore(baseDir)
    this.designStore = new FileDesignStore(baseDir)
    this.approval = approval
  }

  async createSpec(input: SddSpecInput): Promise<SddPipelineState> {
    const spec = createSpec(input, this.baseDir)
    await writeSpecFiles(spec, input)
    await this.specStore.save(spec)
    return { currentStage: 'spec', spec, error: undefined }
  }

  async approveSpec(specId: string, resolver = 'human'): Promise<SddPipelineState> {
    const spec = await this.specStore.get(specId)
    if (!spec) return { currentStage: 'spec', error: `Spec ${specId} not found` }

    const approvalReq = await this.approval.request(
      `approve_spec:${specId}`,
      `Approve spec ${spec.title}`,
      'medium'
    )
    const resolved = await this.approval.waitFor(approvalReq.id)
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
    buildKickoffPacket(spec) // build but don't store yet
    await writeDesignFile(design, '')
    await this.designStore.save(design)

    return { currentStage: 'design', spec, design }
  }

  async approveDesign(
    designId: string,
    evidence: DesignEvidence[],
    kickoff?: TechnicalKickoffPacket,
    resolver = 'human'
  ): Promise<SddPipelineState> {
    const design = await this.designStore.get(designId)
    if (!design) return { currentStage: 'design', error: `Design ${designId} not found` }

    const spec = await this.specStore.get(design.specId)

    const review = selfReview(evidence, kickoff)
    if (review.verdict !== 'PASS') {
      return {
        currentStage: 'design',
        spec,
        design,
        error: `Self review: ${review.verdict} - ${review.blockers.join(', ')}`,
      }
    }

    const readiness = validateDesignReadiness(design, spec, evidence, kickoff)
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
    const resolved = await this.approval.waitFor(approvalReq.id)
    if ('error' in resolved) return { currentStage: 'design', spec, design, error: resolved.error }

    if (resolved.status === 'approved') {
      const body = await readDesignFile(design)
      const productFp = computeProductFingerprint(spec?.revision || '', spec?.revision || '')
      const evidenceFp = computeEvidenceFingerprint(
        evidence.map((e) => e.id),
        Object.fromEntries(evidence.map((e) => [e.id, e.commit]))
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
