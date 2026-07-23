import { ImpactSurface, EvidenceRow } from './types'

export interface EpicNode {
  id: string
  name: string
  description: string
  surfaces: ImpactSurface[]
  evidence: EvidenceRow[]
  dependencies: string[]
}

export interface CrossEpicTraversal {
  status: 'complete' | 'partial' | 'pending'
  affectedEpics: EpicNode[]
  traversalPath: string[]
  gaps: string[]
}

export function traverseCrossEpic(
  allEpics: EpicNode[],
  startEpicIds: string[],
  maxDepth = 3
): CrossEpicTraversal {
  const affected: EpicNode[] = []
  const traversalPath: string[] = []
  const gaps: string[] = []
  const visited = new Set<string>()

  function dfs(epicId: string, depth: number) {
    if (depth > maxDepth || visited.has(epicId)) return
    visited.add(epicId)

    const epic = allEpics.find((e) => e.id === epicId)
    if (!epic) {
      gaps.push(`Epic ${epicId} not found`)
      return
    }

    traversalPath.push(epicId)
    affected.push(epic)

    for (const depId of epic.dependencies) {
      dfs(depId, depth + 1)
    }
  }

  for (const id of startEpicIds) {
    dfs(id, 0)
  }

  return {
    status: gaps.length === 0 ? 'complete' : 'partial',
    affectedEpics: affected,
    traversalPath,
    gaps,
  }
}

export function findOverlappingSurfaces(
  epics: EpicNode[],
  changedFiles: string[]
): ImpactSurface[] {
  const overlaps: ImpactSurface[] = []
  const fileSet = new Set(changedFiles.map((f) => f.toLowerCase()))

  for (const epic of epics) {
    for (const surface of epic.surfaces) {
      if (surface.filePath && fileSet.has(surface.filePath.toLowerCase())) {
        overlaps.push(surface)
      }
    }
  }

  return overlaps
}
