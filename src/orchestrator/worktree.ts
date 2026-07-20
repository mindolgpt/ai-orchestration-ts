import * as fs from 'fs/promises'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveProjectRoot } from '@/knowledge/paths'

const execFileAsync = promisify(execFile)

export interface WorktreeInfo {
  path: string
  branch: string
  sessionId: string
}

/**
 * Create an isolated git worktree for a session/task.
 * Branch: aio/<sessionId>
 */
export async function createWorktree(
  sessionId: string,
  projectRoot?: string
): Promise<WorktreeInfo> {
  const root = projectRoot || resolveProjectRoot()
  const branch = `aio/${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const wtPath = path.join(root, '.aio', 'worktrees', sessionId)

  await fs.mkdir(path.dirname(wtPath), { recursive: true })

  // Remove leftover
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', wtPath], {
      cwd: root,
      windowsHide: true,
    })
  } catch {
    /* none */
  }

  try {
    await execFileAsync('git', ['worktree', 'add', '-b', branch, wtPath], {
      cwd: root,
      windowsHide: true,
    })
  } catch (err) {
    // Branch may exist — try without -b
    try {
      await execFileAsync('git', ['worktree', 'add', wtPath, branch], {
        cwd: root,
        windowsHide: true,
      })
    } catch {
      throw new Error(
        `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return { path: wtPath, branch, sessionId }
}

export async function removeWorktree(
  sessionId: string,
  projectRoot?: string,
  deleteBranch = false
): Promise<{ removed: boolean; path: string }> {
  const root = projectRoot || resolveProjectRoot()
  const wtPath = path.join(root, '.aio', 'worktrees', sessionId)
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', wtPath], {
      cwd: root,
      windowsHide: true,
    })
  } catch {
    return { removed: false, path: wtPath }
  }
  if (deleteBranch) {
    const branch = `aio/${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    try {
      await execFileAsync('git', ['branch', '-D', branch], {
        cwd: root,
        windowsHide: true,
      })
    } catch {
      /* ignore */
    }
  }
  return { removed: true, path: wtPath }
}

export async function listWorktrees(projectRoot?: string): Promise<string> {
  const root = projectRoot || resolveProjectRoot()
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      windowsHide: true,
    })
    return stdout
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
