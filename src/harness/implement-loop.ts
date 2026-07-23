import { resolveProjectRoot } from '@/knowledge/paths'
import { getEventLog } from '@/observability/events'
import { createRalphLoop } from '@/ralph/loop'
import { createVerifier } from '@/ralph/verifier'
import * as path from 'path'
import * as fs from 'fs/promises'

export interface ImplementLoopTask {
  id: string
  label: string
  prompt?: string
}

export interface ImplementLoopOptions {
  projectRoot?: string
  tasks?: ImplementLoopTask[]
  spec_id?: string
  ralph_max_retries?: number
  /** When true, only plan + verify without spawning sessions */
  dry_run?: boolean
}

export interface ImplementLoopResult {
  ok: boolean
  project_root: string
  tasks: Array<{ id: string; status: string; detail?: string; attempts?: number }>
  dod: string[]
  next_steps: string[]
}

const DOD = [
  'Satisfy related SDD acceptance criteria',
  'Cite wiki pages or AC ids in the change summary',
  'Update packages/contracts when APIs change',
  'Pass verify ladder: build, lint, typecheck, test, acceptance before self-report',
]

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

export async function runImplementLoop(
  opts: ImplementLoopOptions = {}
): Promise<ImplementLoopResult> {
  const root = path.resolve(opts.projectRoot || resolveProjectRoot())
  const tasks = opts.tasks?.length ? opts.tasks : await loadTasksFromSdd(root, opts.spec_id)
  const results: ImplementLoopResult['tasks'] = []
  const events = getEventLog(root)

  await events.emit('implement_loop.start', { task_count: tasks.length })

  const ralph = createRalphLoop({
    maxRetries: opts.ralph_max_retries ?? 10,
    verifyEvery: 1,
    onProgress: (msg) => {
      void events.emit('ralph.progress', { message: msg })
    },
  })
  const verifier = createVerifier(root, {
    steps: ['build', 'lint', 'typecheck', 'test', 'acceptance'],
  })

  for (const task of tasks) {
    if (opts.dry_run) {
      results.push({ id: task.id, status: 'planned', detail: task.label })
      continue
    }

    const outcome = await ralph.run(
      task.id,
      async () => {
        // Session spawning is handled by execute_dag in full mode; here we verify DoD locally.
        return { planned: task.label, prompt: task.prompt }
      },
      async () => {
        const report = await verifier.verifyAll()
        return { ok: report.ok, detail: report.detail }
      }
    )

    results.push({
      id: task.id,
      status: outcome.status,
      detail: outcome.error || undefined,
      attempts: outcome.attempts,
    })
    await events.emit('implement_loop.task', {
      id: task.id,
      status: outcome.status,
      attempts: outcome.attempts,
    })
  }

  const ok = results.every((r) => r.status === 'success' || r.status === 'planned')
  await events.emit('implement_loop.done', { ok })

  return {
    ok,
    project_root: root,
    tasks: results,
    dod: DOD,
    next_steps: ok
      ? [
          'file_back durable decisions',
          'lint_wiki --deep',
          'resume bootstrap_product if more phases',
        ]
      : [
          'Inspect failing verify steps',
          'Fix code until DoD passes',
          'run_implement_loop again or execute_dag with ralph_verify',
        ],
  }
}
