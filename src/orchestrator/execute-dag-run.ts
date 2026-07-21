import { createDAG, createTaskNode } from '@/dag'
import { DAGExecutor } from '@/dag/engine'
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from '@/dag/checkpoint'
import { TaskStatus } from '@/dag/types'
import { ChildSession, spawnSession, waitForSession } from '@/mcp/tools/session-tools'
import { MessageInbox } from '@/mcp/inbox'
import { getEventLog } from '@/observability/events'
import { ApprovalGate, looksDangerous } from '@/orchestrator/approval'

export interface DagTaskInput {
  id: string
  label: string
  deps?: string[]
  prompt?: string
  timeout_ms?: number
}

export interface ExecuteDagRunInput {
  plan_id: string
  tasks: DagTaskInput[]
  fail_fast?: boolean
  max_parallel?: number
  resume?: boolean
  clear_checkpoint?: boolean
  only_node_ids?: string[]
  worktree?: boolean
  runtime?: 'opencode' | 'claude' | 'cursor' | 'codex' | 'custom'
  require_approval_if_dangerous?: boolean
  approval_id?: string
  skip_approval?: boolean
}

export interface ExecuteDagRunContext {
  projectRoot: string
  sessions: Map<string, ChildSession>
  inbox: MessageInbox
  dagResults: Map<string, unknown>
  maxSessions: number
  approval?: ApprovalGate
}

export async function executeDagRun(
  ctx: ExecuteDagRunContext,
  args: ExecuteDagRunInput
): Promise<Record<string, unknown>> {
  const { projectRoot, sessions, inbox, dagResults, maxSessions, approval } = ctx
  const root = projectRoot

  if (args.clear_checkpoint) {
    await clearCheckpoint(args.plan_id, root)
  }

  const dag = createDAG()
  const promptById = new Map<string, string | undefined>()
  for (const t of args.tasks) {
    const node = createTaskNode(t.id, t.label, undefined, t.deps)
    if (t.timeout_ms) node.timeout = t.timeout_ms
    dag.addNode(node)
    promptById.set(t.id, t.prompt)
  }

  const validationError = dag.validate()
  if (validationError) {
    return { ok: false, error: validationError }
  }

  let seed: Record<string, unknown> = {}
  if (args.resume) {
    const cp = await loadCheckpoint(args.plan_id, root)
    if (cp) {
      seed = { ...cp.results }
      for (const [id, status] of Object.entries(cp.nodeStatuses)) {
        if (status === 'success' && seed[id] !== undefined) {
          const n = dag.getNode(id)
          if (n) {
            n.status = 'success'
            n.result = seed[id]
          }
        }
      }
      for (const [id, val] of Object.entries(seed)) {
        dagResults.set(id, val)
      }
    }
  }

  for (const [id, val] of dagResults) {
    if (!(id in seed)) seed[id] = val
  }

  const skipAllowed = args.skip_approval === true && process.env.AIO_ALLOW_SKIP_APPROVAL === '1'
  const needGate = args.require_approval_if_dangerous !== false && !skipAllowed && !!approval
  if (needGate && approval) {
    let approved = false
    if (args.approval_id) {
      const existing = approval.get(args.approval_id)
      approved = existing?.status === 'approved'
      if (existing && existing.status !== 'approved') {
        return {
          ok: false,
          blocked: true,
          reason: 'approval_not_granted',
          approval_id: args.approval_id,
          status: existing.status,
        }
      }
    }
    if (!approved) {
      const dangerous = args.tasks.filter(
        (t) => looksDangerous(t.prompt || '') || looksDangerous(t.label)
      )
      if (dangerous.length) {
        const req = await approval.request(
          'execute_dag',
          `Plan ${args.plan_id} has ${dangerous.length} potentially dangerous task(s): ${dangerous
            .map((d) => d.id)
            .join(', ')}`,
          'high',
          { plan_id: args.plan_id, task_ids: dangerous.map((d) => d.id) }
        )
        return {
          ok: false,
          blocked: true,
          reason: 'approval_required',
          approval_id: req.id,
          hint: 'Resolve via resolve_approval or `aio approval resolve`, then re-run with approval_id.',
        }
      }
    }
  }

  const executor = new DAGExecutor(dag, args.max_parallel ?? Math.min(5, maxSessions))
  const layerMeta = dag.computeLayers()

  await getEventLog().emit('dag.start', {
    plan_id: args.plan_id,
    tasks: args.tasks.length,
    resume: !!args.resume,
  })

  const run = await executor.execute(
    async (node, depResults) => {
      if (dagResults.has(node.id) && seed[node.id] !== undefined) {
        return dagResults.get(node.id)
      }
      if (dagResults.has(node.id) && !promptById.get(node.id)) {
        return { cached: true, result: dagResults.get(node.id) }
      }

      const prompt = promptById.get(node.id)
      if (!prompt) {
        return { planned: true, label: node.label }
      }

      if (seed[node.id] !== undefined) {
        return seed[node.id]
      }

      const context = Object.keys(depResults).length
        ? `Upstream results:\n${JSON.stringify(depResults, null, 2).slice(0, 4000)}`
        : undefined

      const spawned = await spawnSession(sessions, inbox, maxSessions, prompt, context, {
        worktree: args.worktree,
        runtime: args.runtime,
        projectRoot: root,
      })
      const sessionId = typeof spawned.session_id === 'string' ? spawned.session_id : ''
      if (spawned.error || !sessionId) {
        const errMsg = typeof spawned.error === 'string' ? spawned.error : 'spawn failed'
        throw new Error(errMsg)
      }

      const waited = await waitForSession(sessions, inbox, sessionId, node.timeout || 300_000)
      if (waited.status !== 'completed') {
        throw new Error(`session ${sessionId} ended with ${waited.status}`)
      }

      const payload = {
        session_id: sessionId,
        summary: waited.result,
      }
      dagResults.set(node.id, payload)
      return payload
    },
    {
      failFast: args.fail_fast ?? false,
      seedResults: seed,
      onlyNodeIds: args.only_node_ids,
      onNodeDone: async (node, results) => {
        const nodeStatuses: Record<string, TaskStatus> = {}
        for (const n of dag.nodes.values()) {
          nodeStatuses[n.id] = n.status
        }
        const resultsObj: Record<string, unknown> = {}
        for (const [k, v] of results) resultsObj[k] = v
        await saveCheckpoint(
          {
            planId: args.plan_id,
            results: resultsObj,
            nodeStatuses,
            updatedAt: Date.now(),
          },
          root
        )
        await getEventLog().emit('dag.node', {
          plan_id: args.plan_id,
          node_id: node.id,
          status: node.status,
        })
      },
    }
  )

  if (run.status === 'completed') {
    await clearCheckpoint(args.plan_id, root)
  }

  await getEventLog().emit('dag.done', {
    plan_id: args.plan_id,
    status: run.status,
    success: run.success,
    failed: run.failed,
    skipped: run.skipped,
  })

  const nodeStatuses = Array.from(dag.nodes.values()).map((n) => ({
    id: n.id,
    label: n.label,
    status: n.status,
    error: n.error,
    result: n.result,
  }))

  return {
    plan_id: args.plan_id,
    task_count: args.tasks.length,
    layer_count: Object.keys(layerMeta).length,
    layers: layerMeta,
    status: run.status,
    success: run.success,
    failed: run.failed,
    skipped: run.skipped,
    resumed: !!args.resume,
    auto_planned: args.tasks.every((t) => !t.prompt),
    checkpoint:
      run.status === 'completed'
        ? null
        : `.aio/checkpoints/${args.plan_id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}.json`,
    nodes: nodeStatuses,
  }
}
