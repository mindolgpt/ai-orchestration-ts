import { DAG } from '@/dag'
import { DAGExecutor, DAGExecuteResult } from '@/dag/engine'
import { createRalphLoop, RalphLoop } from '@/ralph/loop'
import { createVerifier, Verifier } from '@/ralph/verifier'
import { resolveProjectRoot } from '@/knowledge/paths'

export interface DAGOrchestratorOptions {
  maxParallel?: number
  ralphMaxRetries?: number
  projectRoot?: string
  /** When true, run Verifier after each task implement. Default true if projectRoot resolvable. */
  enableVerify?: boolean
  /** Override verify steps (or use AIO_VERIFY_STEPS). */
  verifySteps?: Array<'build' | 'lint' | 'test' | 'custom'>
}

export class DAGOrchestrator {
  private ralph: RalphLoop
  private maxParallel: number
  private verifier: Verifier | null
  private enableVerify: boolean

  constructor(maxParallelOrOpts: number | DAGOrchestratorOptions = 5, ralphMaxRetries = 3) {
    const opts: DAGOrchestratorOptions =
      typeof maxParallelOrOpts === 'number'
        ? { maxParallel: maxParallelOrOpts, ralphMaxRetries }
        : maxParallelOrOpts

    this.maxParallel = opts.maxParallel ?? 5
    this.ralph = createRalphLoop({
      maxRetries: opts.ralphMaxRetries ?? 3,
      verifyEvery: 1,
    })
    const root = opts.projectRoot ?? resolveProjectRoot()
    this.enableVerify = opts.enableVerify ?? true
    this.verifier = this.enableVerify ? createVerifier(root, { steps: opts.verifySteps }) : null
  }

  async executeDAG(
    dag: DAG,
    taskImplementations?: Map<string, () => Promise<unknown>>
  ): Promise<Map<string, unknown>> {
    const detailed = await this.executeDAGDetailed(dag, taskImplementations)
    return detailed.results
  }

  async executeDAGDetailed(
    dag: DAG,
    taskImplementations?: Map<string, () => Promise<unknown>>
  ): Promise<DAGExecuteResult> {
    if (taskImplementations) {
      for (const [id, fn] of taskImplementations) {
        const node = dag.getNode(id)
        if (node) node.fn = fn
      }
    }

    const executor = new DAGExecutor(dag, this.maxParallel)
    return executor.execute(async (node) => {
      if (!node.fn) return null
      const ralphResult = await this.ralph.run(node.id, node.fn, async () => {
        if (!this.verifier) return { ok: true, detail: 'verify disabled' }
        const report = await this.verifier.verifyAll()
        return { ok: report.ok, detail: report.detail }
      })
      if (ralphResult.status !== 'success') {
        throw new Error(ralphResult.error || `Ralph failed for ${node.id}`)
      }
      return ralphResult.output
    })
  }

  summary(): string {
    return `DAG Orchestrator • ${this.ralph.summary()}`
  }
}

export function createDAGOrchestrator(
  maxParallel?: number,
  ralphMaxRetries?: number
): DAGOrchestrator {
  return new DAGOrchestrator(maxParallel, ralphMaxRetries)
}
