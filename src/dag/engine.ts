import { TaskNode, TaskStatus, DAG } from '@/dag'

export type DAGRunStatus = 'completed' | 'partial' | 'failed'

export interface DAGExecuteOptions {
  failFast?: boolean
  onProgress?: (node: TaskNode) => void
  /** Pre-seed successful results (resume / cache). Nodes present here are marked success and skipped. */
  seedResults?: Map<string, unknown> | Record<string, unknown>
  /** Only run these node ids (and their unmet deps still apply). */
  onlyNodeIds?: string[]
  /** Skip running nodes that already succeeded in seed (default true when seed provided). */
  skipSeeded?: boolean
  /** Persist callback after each node settles */
  onNodeDone?: (node: TaskNode, results: Map<string, unknown>) => void | Promise<void>
}

export interface DAGExecuteResult {
  results: Map<string, unknown>
  status: DAGRunStatus
  success: number
  failed: number
  skipped: number
}

export type TaskRunner = (node: TaskNode, depResults: Record<string, unknown>) => Promise<unknown>

function toMap(seed?: Map<string, unknown> | Record<string, unknown>): Map<string, unknown> {
  if (!seed) return new Map()
  if (seed instanceof Map) return new Map(seed)
  return new Map(Object.entries(seed))
}

export class DAGExecutor {
  private results: Map<string, unknown> = new Map()

  constructor(
    private dag: DAG,
    private maxParallel = 5,
    private onProgress?: (node: TaskNode) => void
  ) {}

  async execute(
    taskRunner: TaskRunner,
    options: DAGExecuteOptions = {}
  ): Promise<DAGExecuteResult> {
    const error = this.dag.validate()
    if (error) throw new Error(`DAG validation failed: ${error}`)

    this.results = toMap(options.seedResults)
    const skipSeeded = options.skipSeeded ?? this.results.size > 0
    const only = options.onlyNodeIds ? new Set(options.onlyNodeIds) : null

    if (skipSeeded) {
      for (const [id, value] of this.results) {
        const node = this.dag.getNode(id)
        if (node && node.status === 'pending') {
          node.status = 'success'
          node.result = value
        }
      }
    }

    const layers = this.dag.computeLayers()
    let aborted = false

    for (const [, nodes] of Object.entries(layers).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      if (aborted) {
        for (const node of nodes) {
          if (node.status === 'pending') {
            node.status = 'skipped'
            node.error = 'Skipped due to earlier critical failure'
          }
        }
        continue
      }

      for (const node of nodes) {
        if (node.status !== 'pending') continue

        if (only && !only.has(node.id)) {
          // If not in only-set but already seeded success, leave it; else skip
          if (!this.results.has(node.id)) {
            node.status = 'skipped'
            node.error = 'Skipped (not in onlyNodeIds)'
          }
          continue
        }

        const depsFailed = node.deps.some((d) => {
          const dep = this.dag.getNode(d)
          return dep && (dep.status === 'failed' || dep.status === 'skipped')
        })
        if (depsFailed) {
          node.status = 'skipped'
          node.error = 'Skipped because a dependency failed or was skipped'
        }
      }

      const runnable = nodes.filter((n) => n.status === 'pending')
      const semaphore = new Semaphore(this.maxParallel)

      await Promise.all(runnable.map((node) => this.runNode(node, taskRunner, semaphore, options)))

      const failed = nodes.filter((n) => n.status === 'failed')
      if (failed.length > 0 && options.failFast) {
        aborted = true
      }
    }

    return this.summarize()
  }

  private async runNode(
    node: TaskNode,
    taskRunner: TaskRunner,
    semaphore: Semaphore,
    options: DAGExecuteOptions
  ): Promise<void> {
    await semaphore.acquire()
    try {
      node.status = 'running'
      this.onProgress?.(node)
      options.onProgress?.(node)

      const depResults: Record<string, unknown> = {}
      for (const d of node.deps) {
        if (this.results.has(d)) depResults[d] = this.results.get(d)
      }

      const work = Promise.resolve(taskRunner(node, depResults))
      const result =
        node.timeout > 0
          ? await Promise.race([
              work,
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Task ${node.id} timed out after ${node.timeout}ms`)),
                  node.timeout
                )
              ),
            ])
          : await work

      node.status = 'success'
      node.result = result
      this.results.set(node.id, result)
    } catch (error) {
      node.status = 'failed'
      node.error = error instanceof Error ? error.message : String(error)
    } finally {
      try {
        await options.onNodeDone?.(node, this.results)
      } catch {
        /* ignore checkpoint errors */
      }
      semaphore.release()
    }
  }

  private summarize(): DAGExecuteResult {
    const statuses = Array.from(this.dag.nodes.values()).map((n) => n.status)
    const success = statuses.filter((s) => s === 'success').length
    const failed = statuses.filter((s) => s === 'failed').length
    const skipped = statuses.filter((s) => s === 'skipped').length
    let status: DAGRunStatus = 'completed'
    if (failed > 0 && success === 0) status = 'failed'
    else if (failed > 0 || skipped > 0) status = 'partial'
    return { results: this.results, status, success, failed, skipped }
  }

  getResults(): Map<string, unknown> {
    return this.results
  }

  getNodeStatus(id: string): TaskStatus | undefined {
    return this.dag.nodes.get(id)?.status
  }
}

class Semaphore {
  private permits: number
  private waitQueue: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }
    return new Promise((resolve) => this.waitQueue.push(resolve))
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!
      next()
    } else {
      this.permits++
    }
  }
}
