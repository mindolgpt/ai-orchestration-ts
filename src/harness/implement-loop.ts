/**
 * Implement Loop — State Machine
 *
 * Instead of a synchronous Ralph retry loop that spawns child processes,
 * this uses a disk-persisted state machine. The host agent (the caller)
 * drives each task manually:
 *
 *   1. implement_loop_start   → create state, get first task
 *   2. Host agent writes code, runs tests locally
 *   3. implement_loop_report  → MCP verifies (build/lint/typecheck/test)
 *   4. If verify OK  → advance to next task
 *      If verify FAIL → increment attempts; re-report or mark failed
 *   5. implement_loop_status  → check progress at any time
 *
 * No CLI binary (opencode/claude/cursor/codex) is needed.
 */

import { resolveProjectRoot } from '@/knowledge/paths'
import { getEventLog } from '@/observability/events'
import { createVerifier, VerifyReport } from '@/ralph/verifier'
import { randomUUID } from 'crypto'
import * as path from 'path'
import * as fs from 'fs/promises'

// ── Public Types ──

export interface ImplementLoopTask {
  id: string
  label: string
  prompt?: string
}

export interface ImplementLoopResult {
  ok: boolean
  project_root: string
  tasks: Array<{ id: string; status: string; detail?: string; attempts?: number }>
  dod: string[]
  next_steps: string[]
}

// ── Internal State Shape ──

interface TaskState {
  id: string
  label: string
  prompt: string
  status: 'pending' | 'completed' | 'failed'
  attempts: number
  last_attempt_summary?: string
  last_verify_error?: string
}

interface ImplementLoopState {
  run_id: string
  spec_id?: string
  status: 'running' | 'completed' | 'failed'
  created_at: number
  updated_at: number
  tasks: TaskState[]
  current_task_index: number
  dod: string[]
  ralph_max_retries: number
}

// ── Constants ──

const DOD = [
  'Satisfy related SDD acceptance criteria',
  'Cite wiki pages or AC ids in the change summary',
  'Update packages/contracts when APIs change',
  'Pass verify ladder: build, lint, typecheck, test, acceptance before self-report',
]

function stateDir(root: string): string {
  return path.join(root, '.aio', 'implement-loop')
}

function stateFilePath(root: string, runId: string): string {
  return path.join(stateDir(root), `${runId}.json`)
}

// ── Task Loading ──

async function loadTasksFromSdd(root: string, specId?: string): Promise<ImplementLoopTask[]> {
  const sddRoot = path.join(root, '.aio', 'sdd')
  try {
    const entries = await fs.readdir(sddRoot, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name === 'meta') continue
      if (specId && !ent.name.includes(specId) && ent.name !== specId) continue
      const tasksPath = path.join(sddRoot, ent.name, 'tasks.md')
      try {
        const body = await fs.readFile(tasksPath, 'utf-8')
        const rows = body
          .split('\n')
          .filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('Module'))
        const tasks: ImplementLoopTask[] = []
        for (const row of rows) {
          const cols = row
            .split('|')
            .map((c) => c.trim())
            .filter(Boolean)
          if (cols.length >= 3) {
            tasks.push({
              id: `t${cols[0]}`,
              label: `${cols[1]}: ${cols[2]}`,
              prompt: `Implement: ${cols[2]} (${cols[3] || ''})\n\nDoD:\n${DOD.map((d) => `- ${d}`).join('\n')}`,
            })
          }
        }
        if (tasks.length) return tasks
      } catch {
        /* next */
      }
    }
  } catch {
    /* empty */
  }
  return [
    {
      id: 'bootstrap-feature',
      label: 'Implement P0 feature slice',
      prompt: `Implement the highest-priority feature from SDD.\n\nDoD:\n${DOD.map((d) => `- ${d}`).join('\n')}`,
    },
  ]
}

// ── Start Implement Loop ──

export async function startImplementLoop(opts: {
  projectRoot?: string
  spec_id?: string
  ralph_max_retries?: number
}): Promise<{
  run_id: string
  current_task: { id: string; label: string; prompt: string; index: number } | null
  task_count: number
  completed_count: number
  state_path: string
}> {
  const root = path.resolve(opts.projectRoot || resolveProjectRoot())
  const tasks = await loadTasksFromSdd(root, opts.spec_id)
  const run_id = `impl_${randomUUID().slice(0, 8)}`
  const maxRetries = opts.ralph_max_retries ?? 10

  const state: ImplementLoopState = {
    run_id,
    spec_id: opts.spec_id,
    status: 'running',
    created_at: Date.now(),
    updated_at: Date.now(),
    tasks: tasks.map((t) => ({
      id: t.id,
      label: t.label,
      prompt: t.prompt || `Implement: ${t.label}\n\nDoD:\n${DOD.map((d) => `- ${d}`).join('\n')}`,
      status: 'pending' as const,
      attempts: 0,
    })),
    current_task_index: 0,
    dod: DOD,
    ralph_max_retries: maxRetries,
  }

  const sPath = stateFilePath(root, run_id)
  await fs.mkdir(path.dirname(sPath), { recursive: true })
  await fs.writeFile(sPath, JSON.stringify(state, null, 2), 'utf-8')

  const first = state.tasks[0] || null
  const completed = state.tasks.filter((t) => t.status === 'completed').length

  await getEventLog(root).emit('implement_loop.start', {
    run_id,
    task_count: tasks.length,
  })

  return {
    run_id,
    current_task: first
      ? { id: first.id, label: first.label, prompt: first.prompt, index: 0 }
      : null,
    task_count: tasks.length,
    completed_count: completed,
    state_path: sPath,
  }
}

// ── Report Task Result ──

export async function reportImplementLoopResult(opts: {
  run_id: string
  task_id: string
  status: 'completed' | 'failed'
  summary?: string
  projectRoot?: string
}): Promise<{
  status: 'continue' | 'completed' | 'failed'
  current_task?: {
    id: string
    label: string
    prompt: string
    index: number
    attempts: number
    verify_error?: string
  }
  verify_report?: VerifyReport
  final_result?: ImplementLoopResult
}> {
  const root = path.resolve(opts.projectRoot || resolveProjectRoot())
  const sPath = stateFilePath(root, opts.run_id)

  // ── Load state ──
  let state: ImplementLoopState
  try {
    const raw = await fs.readFile(sPath, 'utf-8')
    state = JSON.parse(raw) as ImplementLoopState
  } catch {
    return {
      status: 'failed',
      final_result: {
        ok: false,
        project_root: root,
        tasks: [],
        dod: DOD,
        next_steps: [`State file not found: ${sPath}. Start a new loop with implement_loop_start.`],
      },
    }
  }

  if (state.status !== 'running') {
    return finishReport(root, state)
  }

  // ── Find task ──
  const taskIdx = state.tasks.findIndex((t) => t.id === opts.task_id)
  if (taskIdx < 0) {
    return {
      status: 'failed',
      final_result: {
        ok: false,
        project_root: root,
        tasks: state.tasks.map((t) => ({
          id: t.id,
          status: t.status,
          attempts: t.attempts,
        })),
        dod: DOD,
        next_steps: [`Task ${opts.task_id} not found in run ${opts.run_id}`],
      },
    }
  }

  const task = state.tasks[taskIdx]
  task.attempts++
  task.last_attempt_summary = opts.summary

  // ── User marked as failed → skip to next ──
  if (opts.status === 'failed') {
    task.status = 'failed'
    await advanceAndSave(sPath, state)
    return finishReport(root, state)
  }

  // ── User marked as completed → run verification ──
  const verifier = createVerifier(root, {
    steps: ['build', 'lint', 'typecheck', 'test', 'acceptance'],
  })
  const verifyReport = await verifier.verifyAll()

  if (verifyReport.ok) {
    // ✅ Task passes all checks
    task.status = 'completed'
    task.last_verify_error = undefined
    await advanceAndSave(sPath, state)

    const base = finishReport(root, state)
    return { ...base, verify_report: verifyReport }
  }

  // ❌ Verify failed
  task.last_verify_error = verifyReport.detail

  if (task.attempts >= state.ralph_max_retries) {
    task.status = 'failed'
    await advanceAndSave(sPath, state)

    const base = finishReport(root, state)
    return { ...base, verify_report: verifyReport }
  }

  // 🔁 Retry — inject verify feedback into prompt
  await saveState(sPath, state)

  const retryPrompt = buildRetryPrompt(task.prompt, task.last_attempt_summary, verifyReport.detail)

  return {
    status: 'continue',
    current_task: {
      id: task.id,
      label: task.label,
      prompt: retryPrompt,
      index: taskIdx,
      attempts: task.attempts,
      verify_error: verifyReport.detail,
    },
    verify_report: verifyReport,
  }
}

// ── Get Status ──

export async function getImplementLoopStatus(opts: {
  run_id: string
  projectRoot?: string
}): Promise<{
  run_id: string
  status: string
  tasks: Array<{ id: string; label: string; status: string; attempts: number }>
  current_task_index: number
  state_path: string
}> {
  const root = path.resolve(opts.projectRoot || resolveProjectRoot())
  const sPath = stateFilePath(root, opts.run_id)
  const raw = await fs.readFile(sPath, 'utf-8')
  const state = JSON.parse(raw) as ImplementLoopState
  return {
    run_id: state.run_id,
    status: state.status,
    tasks: state.tasks.map((t) => ({
      id: t.id,
      label: t.label,
      status: t.status,
      attempts: t.attempts,
    })),
    current_task_index: state.current_task_index,
    state_path: sPath,
  }
}

// ── Helpers ──

function buildRetryPrompt(basePrompt: string, lastSummary?: string, verifyError?: string): string {
  const parts = [basePrompt.trim()]
  if (lastSummary) {
    parts.push(`\n\n[Previous attempt summary]\n${lastSummary}`)
  }
  if (verifyError) {
    parts.push(`\n\n[Verification failures to fix]\n${verifyError}`)
  }
  parts.push(`\n\nDoD:\n${DOD.map((d) => `- ${d}`).join('\n')}`)
  return parts.join('')
}

async function advanceAndSave(sPath: string, state: ImplementLoopState): Promise<void> {
  // Mark current as done (already done by caller), find next pending
  const nextIdx = state.tasks.findIndex(
    (t, i) => i > state.current_task_index && t.status === 'pending'
  )
  if (nextIdx >= 0) {
    state.current_task_index = nextIdx
  } else {
    // Any remaining pending (before current index)?
    const anyPending = state.tasks.findIndex((t) => t.status === 'pending')
    if (anyPending >= 0) {
      state.current_task_index = anyPending
    } else {
      state.status = state.tasks.every((t) => t.status === 'completed') ? 'completed' : 'failed'
    }
  }
  state.updated_at = Date.now()
  await saveState(sPath, state)
}

async function saveState(sPath: string, state: ImplementLoopState): Promise<void> {
  await fs.writeFile(sPath, JSON.stringify(state, null, 2), 'utf-8')
}

function finishReport(
  root: string,
  state: ImplementLoopState
): {
  status: 'continue' | 'completed' | 'failed'
  current_task?: {
    id: string
    label: string
    prompt: string
    index: number
    attempts: number
    verify_error?: string
  }
  final_result?: ImplementLoopResult
} {
  if (state.status === 'running') {
    const current = state.tasks[state.current_task_index]
    if (current && current.status === 'pending') {
      return {
        status: 'continue',
        current_task: {
          id: current.id,
          label: current.label,
          prompt: current.prompt,
          index: state.current_task_index,
          attempts: current.attempts,
          verify_error: current.last_verify_error,
        },
      }
    }
    // Current is not pending → find any pending
    const pendingIdx = state.tasks.findIndex((t) => t.status === 'pending')
    if (pendingIdx >= 0) {
      state.current_task_index = pendingIdx
      const pTask = state.tasks[pendingIdx]
      return {
        status: 'continue',
        current_task: {
          id: pTask.id,
          label: pTask.label,
          prompt: pTask.prompt,
          index: pendingIdx,
          attempts: pTask.attempts,
          verify_error: pTask.last_verify_error,
        },
      }
    }
    // No more pending → should not happen with 'running' status, but handle gracefully
    state.status = state.tasks.every((t) => t.status === 'completed') ? 'completed' : 'failed'
  }

  const ok = state.status === 'completed'
  return {
    status: ok ? 'completed' : 'failed',
    final_result: {
      ok,
      project_root: root,
      tasks: state.tasks.map((t) => ({
        id: t.id,
        status: t.status,
        detail: t.last_verify_error || t.last_attempt_summary,
        attempts: t.attempts,
      })),
      dod: DOD,
      next_steps: ok
        ? ['file_back durable decisions', 'lint_wiki --deep']
        : ['Inspect failing tasks', 'Fix code until DoD passes', 'implement_loop_start again'],
    },
  }
}

// ══════════════════════════════════════════════════════════
// Deprecated — kept for backward compatibility
// ══════════════════════════════════════════════════════════

/** @deprecated Use startImplementLoop() + reportImplementLoopResult() instead. */
export async function runImplementLoop(
  _opts: Record<string, unknown> = {}
): Promise<ImplementLoopResult> {
  const root = path.resolve((_opts.projectRoot as string) || resolveProjectRoot())
  return {
    ok: false,
    project_root: root,
    tasks: [],
    dod: DOD,
    next_steps: [
      'runImplementLoop is deprecated.',
      'Use implement_loop_start + implement_loop_report instead (MCP tools).',
      'Call implement_loop_start to begin.',
    ],
  }
}
