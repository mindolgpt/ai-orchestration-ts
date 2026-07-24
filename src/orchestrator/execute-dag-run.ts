import { createDAG, createTaskNode } from '@/dag'
import { DAGExecutor } from '@/dag/engine'
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from '@/dag/checkpoint'
import { TaskStatus } from '@/dag/types'
import { ChildSession, spawnSession, waitForSession } from '@/mcp/tools/session-tools'
import { MessageInbox } from '@/mcp/inbox'
import { getEventLog } from '@/observability/events'
import { ApprovalGate, looksDangerous } from '@/orchestrator/approval'
import { createRalphLoop } from '@/ralph/loop'
import { createVerifier } from '@/ralph/verifier'
import { buildRetryPrompt } from '@/ralph/retry-prompt'

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
  ralph_max_retries?: number
  ralph_verify?: boolean
}

export interface ExecuteDagRunContext {
  projectRoot: string
  sessions: Map<string, ChildSession>
  inbox: MessageInbox
  /** Shared cache of plan results, namespaced by `${planId}::${nodeId}`. */
  dagResults: Map<string, unknown>
  maxSessions: number
  approval?: ApprovalGate
}

/**
 * Build a plan-namespaced key so results from different plans never collide on
 * identical node ids (T1/T2/...). Plain (un-prefixed) ids are treated as
 * legacy entries and ignored when seeding, so a fresh plan never silently
 * "succeeds" by inheriting another plan's result.
 */
function dagResultsKey(planId: string, nodeId: string): string {
  return `${planId}::${nodeId}`
}

function nodeIdsFromPrefix(dagResults: Map<string, unknown>, planId: string): string[] {
  const prefix = `${planId}::`
  const out: string[] = []
  for (const k of dagResults.keys()) {
    if (k.startsWith(prefix)) out.push(k.slice(prefix.length))
  }
  return out
}

export async function executeDagRun(
  ctx: ExecuteDagRunContext,
  args: ExecuteDagRunInput
): Promise<Record<string, unknown>> {
  const { projectRoot, sessions, inbox, dagResults, maxSessions, approval } = ctx
  const root = projectRoot
  const ralph = createRalphLoop({
    maxRetries: args.ralph_max_retries ?? 3,
    verifyEvery: 1,
    onProgress: (msg) => {
      void getEventLog().emit('ralph.progress', { message: msg })
    },
  })
  const verifier = args.ralph_verify !== false ? createVerifier(root) : null

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
        dagResults.set(dagResultsKey(args.plan_id, id), val)
      }
    }
  }

  // Only seed from this plan's namespaced entries; ignore other-plan and
  // legacy (un-prefixed) keys to prevent cross-plan contamination.
  const ownSeedIds = nodeIdsFromPrefix(dagResults, args.plan_id)
  for (const id of ownSeedIds) {
    const val = dagResults.get(dagResultsKey(args.plan_id, id))
    if (val !== undefined && !(id in seed)) seed[id] = val
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
      const ownKey = dagResultsKey(args.plan_id, node.id)
      if (dagResults.has(ownKey) && seed[node.id] !== undefined) {
        return dagResults.get(ownKey)
      }
      if (dagResults.has(ownKey) && !promptById.get(node.id)) {
        return { cached: true, result: dagResults.get(ownKey) }
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

      const result = await ralph.run(
        node.id,
        async (attemptCtx) => {
          // On retries, inject the previous verify/implement failure so the
          // child agent fixes the specific problem instead of blind re-running.
          const attemptPrompt = buildRetryPrompt(prompt, attemptCtx)
          const spawned = await spawnSession(sessions, inbox, maxSessions, attemptPrompt, context, {
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

          return {
            session_id: sessionId,
            summary: waited.result,
          }
        },
        async () => {
          if (!verifier) return { ok: true, detail: 'verify disabled' }
          const report = await verifier.verifyAll()
          return { ok: report.ok, detail: report.detail }
        }
      )

      if (result.status !== 'success') {
        throw new Error(result.error || `Ralph failed for ${node.id}`)
      }

      const payload = result.output as { session_id: string; summary: unknown }
      dagResults.set(dagResultsKey(args.plan_id, node.id), payload)
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
    ralph: ralph.summary(),
  }
}
