import * as fs from 'fs/promises'
import * as path from 'path'
import { TaskStatus } from '@/dag/types'
import { resolveProjectRoot } from '@/knowledge/paths'

export interface DAGCheckpoint {
  planId: string
  results: Record<string, unknown>
  nodeStatuses: Record<string, TaskStatus>
  updatedAt: number
}

function checkpointPath(planId: string, projectRoot?: string): string {
  const root = projectRoot || resolveProjectRoot()
  const safe = planId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  return path.join(root, '.aio', 'checkpoints', `${safe}.json`)
}

export async function saveCheckpoint(
  checkpoint: DAGCheckpoint,
  projectRoot?: string
): Promise<string> {
  const file = checkpointPath(checkpoint.planId, projectRoot)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(checkpoint, null, 2), 'utf-8')
  return file
}

export async function loadCheckpoint(
  planId: string,
  projectRoot?: string
): Promise<DAGCheckpoint | null> {
  const file = checkpointPath(planId, projectRoot)
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as DAGCheckpoint
  } catch {
    return null
  }
}

export async function clearCheckpoint(planId: string, projectRoot?: string): Promise<boolean> {
  const file = checkpointPath(planId, projectRoot)
  try {
    await fs.unlink(file)
    return true
  } catch {
    return false
  }
}
