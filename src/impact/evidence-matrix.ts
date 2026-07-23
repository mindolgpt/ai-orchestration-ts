import { EvidenceRow, CoverageLevel, SurfaceKind, LifecycleAction } from './types'
import { BoundedSourceRead } from './source-scanner'
import { randomUUID } from 'crypto'

export interface EvidenceCollection {
  rows: EvidenceRow[]
  snapshot: string
}

export function collectEvidence(
  scans: Map<string, BoundedSourceRead>,
  surfaces: { id: string; kind: SurfaceKind; name: string; filePath?: string }[]
): EvidenceCollection {
  const rows: EvidenceRow[] = []

  for (const surface of surfaces) {
    if (!surface.filePath) {
      rows.push(createEvidenceRow(surface, 'candidate', '', 'No source file mapped'))
      continue
    }

    const scan = scans.get(surface.filePath)
    if (!scan || !scan.exists) {
      rows.push(createEvidenceRow(surface, 'candidate', surface.filePath, 'Source file not found'))
      continue
    }

    if (scan.lines.length > 0) {
      rows.push(
        createEvidenceRow(
          surface,
          'confirmed-path',
          surface.filePath,
          `Read ${scan.lines.length} lines`
        )
      )
    } else {
      rows.push(
        createEvidenceRow(surface, 'partial-path', surface.filePath, 'File exists but empty')
      )
    }
  }

  return {
    rows,
    snapshot: computeSnapshot(rows),
  }
}

function createEvidenceRow(
  surface: { id: string; kind: SurfaceKind; name: string },
  coverage: CoverageLevel,
  sourceFile: string,
  finding: string
): EvidenceRow {
  return {
    id: `ev_${randomUUID().slice(0, 8)}`,
    surfaceId: surface.id,
    area: surface.kind,
    coverage,
    sourceFile,
    finding,
    risk: coverage === 'confirmed-path' ? 'low' : coverage === 'candidate' ? 'high' : 'medium',
  }
}

function computeSnapshot(rows: EvidenceRow[]): string {
  const sorted = rows
    .map((r) => `${r.surfaceId}:${r.coverage}`)
    .sort()
    .join(',')
  const hash = 0
  let h = hash
  for (let i = 0; i < sorted.length; i++) {
    h = (h << 5) - h + sorted.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(16).padStart(8, '0')
}

export function categorizeSurfaceAction(
  kind: SurfaceKind,
  isNew: boolean,
  isModified: boolean,
  isDeleted: boolean
): LifecycleAction {
  if (isNew) return 'NEW'
  if (isDeleted) return 'DELETE'
  if (isModified) return 'MODIFY'
  return 'NO-CHANGE'
}
