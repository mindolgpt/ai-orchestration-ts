import { TaskNode, TaskStatus, DAG } from "@/dag";

export class DAGExecutor {
  private results: Map<string, unknown> = new Map();

  constructor(
    private dag: DAG,
    private maxParallel = 5,
    private onProgress?: (node: TaskNode) => void
  ) {}

  async execute(
    taskRunner: (node: TaskNode) => Promise<unknown>
  ): Promise<Map<string, unknown>> {
    const error = this.dag.validate();
    if (error) throw new Error(`DAG validation failed: ${error}`);

    const layers = this.dag.computeLayers();
    console.log(`DAG 실행 시작 - ${this.dag.nodes.size}개 태스크, ${Object.keys(layers).length}개 Layer`);

    for (const [layerNum, nodes] of Object.entries(layers).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      console.log(`Layer ${layerNum}: ${nodes.length}개 태스크 병렬 실행`);
      const semaphore = new Semaphore(this.maxParallel);

      await Promise.all(
        nodes.map(node => this.runNode(node, taskRunner, semaphore))
      );

      const failed = nodes.filter(n => n.status === "failed");
      if (failed.length > 0) {
        console.warn(`Layer ${layerNum}: ${failed.length}개 실패, 계속 진행`);
      }
    }

    this.printSummary();
    return this.results;
  }

  private async runNode(
    node: TaskNode,
    taskRunner: (node: TaskNode) => Promise<unknown>,
    semaphore: Semaphore
  ): Promise<void> {
    await semaphore.acquire();
    try {
      node.status = "running";
      this.onProgress?.(node);
      
      const result = await taskRunner(node);
      node.status = "success";
      node.result = result;
      this.results.set(node.id, result);
    } catch (error) {
      node.status = "failed";
      node.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${node.id} (${node.label}): ${node.error}`);
    } finally {
      semaphore.release();
    }
  }

  private printSummary(): void {
    const statuses = Array.from(this.dag.nodes.values()).map(n => n.status);
    const success = statuses.filter(s => s === "success").length;
    const failed = statuses.filter(s => s === "failed").length;
    console.log(`\nDAG 실행 완료 - 성공: ${success}, 실패: ${failed}, 전체: ${this.dag.nodes.size}`);
  }

  getResults(): Map<string, unknown> {
    return this.results;
  }

  getNodeStatus(id: string): TaskStatus | undefined {
    return this.dag.nodes.get(id)?.status;
  }
}

class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise(resolve => this.waitQueue.push(resolve));
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}