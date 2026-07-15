import { RalphResult } from "@/ralph/types";

export interface RalphOptions {
  maxRetries: number;
  verifyEvery: number;
  onProgress?: (msg: string) => void;
}

function resolveOptions(options?: Partial<RalphOptions>): RalphOptions {
  return { maxRetries: 3, verifyEvery: 2, ...options };
}

export class RalphLoop {
  private options: RalphOptions;
  private results: Map<string, RalphResult> = new Map();

  constructor(options?: Partial<RalphOptions>) {
    this.options = resolveOptions(options);
  }

  async run(
    taskId: string,
    implementFn: () => Promise<unknown>,
    verifyFn: () => Promise<boolean>
  ): Promise<RalphResult> {
    this.options.onProgress?.(`[Ralph] ${taskId} 시작`);

    const result: RalphResult = {
      taskId,
      status: "running",
      attempts: 0,
      output: null,
      error: null,
      duration: 0,
      startedAt: Date.now()
    };

    const startTime = Date.now();

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      result.attempts = attempt;
      this.options.onProgress?.(`[Ralph] ${taskId} - 시도 ${attempt}/${this.options.maxRetries}`);

      try {
        const output = await implementFn();
        result.output = output;
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        if (attempt < this.options.maxRetries) {
          this.options.onProgress?.(`[Ralph] ${taskId} 구현 실패, 재시도...`);
          await this.sleep(1000);
          continue;
        }
        break;
      }

      if (attempt % this.options.verifyEvery === 0 || attempt === this.options.maxRetries) {
        try {
          const ok = await verifyFn();
          if (ok) {
            result.status = "success";
            this.options.onProgress?.(`[Ralph] ${taskId} 검증 통과`);
            break;
          }
          this.options.onProgress?.(`[Ralph] ${taskId} 검증 실패, 재시도...`);
        } catch (error) {
          this.options.onProgress?.(`[Ralph] ${taskId} 검증 예외: ${error}`);
        }
      }

      if (attempt < this.options.maxRetries) {
        await this.sleep(1000);
      }
    }

    if (result.status !== "success") {
      result.status = "failed";
      this.options.onProgress?.(`[Ralph] ${taskId} ${this.options.maxRetries}회 실패`);
    }

    result.duration = Date.now() - startTime;
    this.results.set(taskId, result);
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getResult(taskId: string): RalphResult | undefined {
    return this.results.get(taskId);
  }

  summary(): string {
    const total = this.results.size;
    const success = Array.from(this.results.values()).filter(r => r.status === "success").length;
    return `Ralph Loop: ${success}/${total} 성공`;
  }
}

export function createRalphLoop(options?: Partial<RalphOptions>): RalphLoop {
  return new RalphLoop(options);
}
