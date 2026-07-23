export type ImpactStatus = 'draft' | 'seeded' | 'complete' | 'partial'
export type CoverageLevel = 'confirmed-path' | 'partial-path' | 'candidate'
export type SurfaceKind = 'screen' | 'api' | 'event' | 'data' | 'external'
export type LifecycleAction =
  'NEW' | 'MODIFY' | 'REUSE' | 'NO-CHANGE' | 'DEPRECATE' | 'DELETE' | 'UNKNOWN'

export interface ImpactDossier {
  id: string
  projectId: string
  specId: string
  status: ImpactStatus
  impactRevision: string
  evidenceSnapshot: string
  createdAt: number
  updatedAt: number
  sourceParity: boolean
  sourceCommits: Record<string, string>
  crossEpicTraversalStatus: 'complete' | 'partial' | 'pending'
  coverageLimits: string[]
  surfaces: ImpactSurface[]
  evidenceMatrix: EvidenceRow[]
  businessDocuments: string[]
  graphTrace?: string
}

export interface ImpactSurface {
  id: string
  kind: SurfaceKind
  name: string
  action: LifecycleAction
  filePath?: string
  risk: 'low' | 'medium' | 'high' | 'critical'
}

export interface EvidenceRow {
  id: string
  surfaceId: string
  area: SurfaceKind
  coverage: CoverageLevel
  sourceFile: string
  sourceCommit?: string
  symbol?: string
  lineRange?: [number, number]
  finding: string
  risk: 'low' | 'medium' | 'high'
  confirmedAt?: number
}

export interface ImpactAnalysisInput {
  changeDescription: string
  affectedFiles?: string[]
  specIds?: string[]
  epics?: string[]
  depth?: 'quick' | 'full'
}

export interface ImpactDossierSummary {
  id: string
  specId: string
  status: ImpactStatus
  surfaceCount: number
  evidenceCount: number
  riskSummary: { low: number; medium: number; high: number; critical: number }
  updatedAt: number
}
