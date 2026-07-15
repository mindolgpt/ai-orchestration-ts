import { DAG } from "@/dag";
import { DAGExecutor } from "@/dag/engine";
import { createRalphLoop, RalphLoop } from "@/ralph/loop";

export class DAGOrchestrator {
  private ralph: RalphLoop;
  private maxParallel: number;

  constructor(maxParallel = 5, ralphMaxRetries = 3) {
    this.maxParallel = maxParallel;
    this.ralph = createRalphLoop({ maxRetries: ralphMaxRetries, verifyEvery: 2 });
  }

  async executeDAG(
    dag: DAG,
    taskImplementations?: Map<string, () => Promise<unknown>>
  ): Promise<Map<string, unknown>> {
    if (taskImplementations) {
      for (const [id, fn] of taskImplementations) {
        const node = dag.getNode(id);
        if (node) node.fn = fn;
      }
    }

    const executor = new DAGExecutor(dag, this.maxParallel);
    const results = await executor.execute(async (node) => {
      if (!node.fn) return null;
      const ralphResult = await this.ralph.run(
        node.id,
        node.fn,
        async () => true
      );
      return ralphResult.output;
    });

    return results;
  }

  summary(): string {
    return `DAG Orchestrator • ${this.ralph.summary()}`;
  }
}

export function createDAGOrchestrator(maxParallel?: number, ralphMaxRetries?: number): DAGOrchestrator {
  return new DAGOrchestrator(maxParallel, ralphMaxRetries);
}