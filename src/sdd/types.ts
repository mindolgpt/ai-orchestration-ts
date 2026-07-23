export type SddStage = 'spec' | 'design' | 'tasks'
export type SddStatus = 'draft' | 'needs_work' | 'approved' | 'stale'

export interface SddSpec {
  id: string
  projectId: string
  title: string
  status: SddStatus
  revision: string
  prdPath: string
  storiesPath: string
  createdAt: number
  approvedAt?: number
  approvedBy?: string
}

export interface SddSpecInput {
  project: string
  title: string
  productContext: string
  requirements: SddRequirement[]
}

export interface SddRequirement {
  id: string
  priority: 'P0' | 'P1' | 'P2'
  description: string
  acceptanceCriteria?: string[]
}

export interface SddDesign {
  id: string
  specId: string
  status: SddStatus
  designRevision: string
  approvedRevision?: string
  productFingerprint: string
  evidenceFingerprint: string
  systemDesignPath: string
  createdAt: number
  approvedAt?: number
  approvedBy?: string
}

export interface SddTasks {
  designId: string
  schemaVersion: 'sdd-tasks.v1'
  designSchemaVersion: 'sdd-design.v1'
  planKind: 'implementation-checklist'
  executionReadiness: 'ready' | 'blocked' | 'not_created'
  tasksPath: string
  createdAt: number
}

export interface DesignEvidence {
  id: string
  proof: 'confirmed-path' | 'partial-path' | 'candidate'
  sourceFile: string
  commit: string
  symbol: string
  lineRange: [number, number]
  finding: string
}

export interface SddPipelineState {
  currentStage: SddStage
  spec?: SddSpec
  design?: SddDesign
  tasks?: SddTasks
  error?: string
}

export interface SddProductInputMetadata {
  specId: string
  requestRevision: string
  storiesRevision: string
  productInputFingerprint: string
  statuses: { request: SddStatus; stories: SddStatus }
}

export interface TechnicalKickoffPacket {
  autoDecisions: Decision[]
  evidenceResolutionItems: EvidenceResolutionItem[]
  technicalOwnerQuestions: TechnicalQuestion[]
}

export interface Decision {
  id: string
  title: string
  recommendation: string
  rationale: string
  affectedIds: string[]
  risk: 'low' | 'medium' | 'high'
  revisitCondition?: string
}

export interface EvidenceResolutionItem {
  id: string
  question: string
  blocksDecision: string
  expectedSource: string
}

export interface TechnicalQuestion {
  id: string
  question: string
  owner: string
  recommendation: string
  tradeoff: string
  affectedProductResult: string
}
