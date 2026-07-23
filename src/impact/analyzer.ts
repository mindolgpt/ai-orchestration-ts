import { randomUUID, createHash } from 'crypto'
import {
  ImpactDossier,
  ImpactAnalysisInput,
  ImpactDossierSummary,
  LifecycleAction,
  SurfaceKind,
  ImpactSurface,
} from './types'
import { readBoundedSource, BoundedSourceRead } from './source-scanner'
import { collectEvidence, categorizeSurfaceAction } from './evidence-matrix'
import { traverseCrossEpic, EpicNode, CrossEpicTraversal } from './cross-epic'

export interface AnalyzerConfig {
  projectRoot: string
  roots: string[]
}

export class ImpactAnalyzer {
  private config: AnalyzerConfig
  private dossiers = new Map<string, ImpactDossier>()

  constructor(config: AnalyzerConfig) {
    this.config = config
  }

  async analyze(input: ImpactAnalysisInput): Promise<ImpactDossier> {
    const id = `impact_${randomUUID().slice(0, 8)}`
    const now = Date.now()

    const rawSurfaces = this.identifySurfaces(input)
    const surfaces: ImpactSurface[] = rawSurfaces.map((s, i) => ({
      id: `S-${String(i + 1).padStart(2, '0')}`,
      ...s,
      risk: s.action === 'DELETE' || s.action === 'MODIFY' ? 'high' : 'low',
    }))
    const scans = await this.scanSources(surfaces)
    const evidence = collectEvidence(scans, surfaces)

    const dossier: ImpactDossier = {
      id,
      projectId: this.config.projectRoot.split('/').pop() || 'unknown',
      specId: input.specIds?.[0] || 'unknown',
      status: 'complete',
      impactRevision: computeDossierRevision(
        evidence.rows.map((r) => `${r.coverage}:${r.sourceFile}`)
      ),
      evidenceSnapshot: evidence.snapshot,
      createdAt: now,
      updatedAt: now,
      sourceParity: true,
      sourceCommits: {},
      crossEpicTraversalStatus: 'pending',
      coverageLimits: input.depth === 'quick' ? ['Quick analysis depth'] : [],
      surfaces,
      evidenceMatrix: evidence.rows,
      businessDocuments: input.specIds || [],
    }

    this.dossiers.set(id, dossier)
    return dossier
  }

  async analyzeWithEpics(
    input: ImpactAnalysisInput,
    epics: EpicNode[]
  ): Promise<ImpactDossier & { crossEpic: CrossEpicTraversal }> {
    const dossier = await this.analyze(input)
    const traversal = traverseCrossEpic(epics, input.epics || [], 3)
    dossier.crossEpicTraversalStatus = traversal.status
    return { ...dossier, crossEpic: traversal }
  }

  private identifySurfaces(
    input: ImpactAnalysisInput
  ): Array<{ kind: SurfaceKind; name: string; filePath?: string; action: LifecycleAction }> {
    const surfaces: Array<{
      kind: SurfaceKind
      name: string
      filePath?: string
      action: LifecycleAction
    }> = []

    if (input.affectedFiles) {
      for (const file of input.affectedFiles) {
        const kind = inferSurfaceKind(file)
        surfaces.push({
          kind,
          name: file.split('/').pop() || file,
          filePath: file,
          action: categorizeSurfaceAction(kind, false, true, false),
        })
      }
    }

    return surfaces
  }

  private async scanSources(
    surfaces: Array<{ name: string; filePath?: string }>
  ): Promise<Map<string, BoundedSourceRead>> {
    const scans = new Map<string, BoundedSourceRead>()

    for (const surface of surfaces) {
      if (surface.filePath) {
        const scan = await readBoundedSource(surface.filePath)
        scans.set(surface.filePath, scan)
      }
    }

    return scans
  }

  getDossier(id: string): ImpactDossier | undefined {
    return this.dossiers.get(id)
  }

  listDossiers(): ImpactDossierSummary[] {
    return Array.from(this.dossiers.values()).map((d) => ({
      id: d.id,
      specId: d.specId,
      status: d.status,
      surfaceCount: d.surfaces.length,
      evidenceCount: d.evidenceMatrix.length,
      riskSummary: {
        low: d.evidenceMatrix.filter((e) => e.risk === 'low').length,
        medium: d.evidenceMatrix.filter((e) => e.risk === 'medium').length,
        high: d.evidenceMatrix.filter((e) => e.risk === 'high').length,
        critical: d.evidenceMatrix.filter((e) => e.risk === 'high' && e.coverage === 'candidate')
          .length,
      },
      updatedAt: d.updatedAt,
    }))
  }
}

function inferSurfaceKind(filePath: string): SurfaceKind {
  const lower = filePath.toLowerCase()
  if (lower.includes('controller') || lower.includes('route') || lower.includes('api')) return 'api'
  if (
    lower.includes('component') ||
    lower.includes('screen') ||
    lower.includes('page') ||
    lower.includes('view')
  )
    return 'screen'
  if (
    lower.includes('model') ||
    lower.includes('entity') ||
    lower.includes('schema') ||
    lower.includes('database')
  )
    return 'data'
  if (
    lower.includes('event') ||
    lower.includes('job') ||
    lower.includes('queue') ||
    lower.includes('worker')
  )
    return 'event'
  if (
    lower.includes('external') ||
    lower.includes('client') ||
    lower.includes('integration') ||
    lower.includes('vendor')
  )
    return 'external'
  return 'api'
}

function computeDossierRevision(items: string[]): string {
  const sorted = [...items].sort().join('|')
  return createHash('sha256').update(sorted, 'utf-8').digest('hex').slice(0, 12)
}
