import { RalphResult } from '@/ralph/types'

export interface RalphOptions {
  maxRetries: number
  /** Verify after every successful implement when 1 (recommended). */
  verifyEvery: number
  baseBackoffMs: number
  onProgress?: (msg: string) => void
  signal?: AbortSignal
}

function resolveOptions(options?: Partial<RalphOptions>): RalphOptions {
  return {
    maxRetries: 3,
    verifyEvery: 1,
    baseBackoffMs: 500,
    ...options,
  }
}

function backoffMs(attempt: number, base: number): number {
  const exp = Math.min(base * 2 ** (attempt - 1), 8000)
  const jitter = Math.floor(Math.random() * base)
  return exp + jitter
}

export class RalphLoop {
  private options: RalphOptions
  private results: Map<string, RalphResult> = new Map()

  constructor(options?: Partial<RalphOptions>) {
    this.options = resolveOptions(options)
  }

  async run(
    taskId: string,
    implementFn: () => Promise<unknown>,
    verifyFn: () => Promise<boolean | { ok: boolean; detail?: string }>
  ): Promise<RalphResult> {
    this.options.onProgress?.(`[Ralph] ${taskId} 시작`)

    const result: RalphResult = {
      taskId,
      status: 'running',
      attempts: 0,
      output: null,
      error: null,
      duration: 0,
      startedAt: Date.now(),
    }

    const startTime = Date.now()

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      this.options.signal?.throwIfAborted()
      result.attempts = attempt
      this.options.onProgress?.(`[Ralph] ${taskId} - 시도 ${attempt}/${this.options.maxRetries}`)

      try {
        result.output = await implementFn()
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error)
        if (attempt < this.options.maxRetries) {
          this.options.onProgress?.(`[Ralph] ${taskId} 구현 실패, 재시도...`)
          await this.sleep(backoffMs(attempt, this.options.baseBackoffMs))
          continue
        }
        break
      }

      const shouldVerify =
        this.options.verifyEvery <= 1 ||
        attempt % this.options.verifyEvery === 0 ||
        attempt === this.options.maxRetries

      if (!shouldVerify) {
        if (attempt < this.options.maxRetries) {
          await this.sleep(backoffMs(attempt, this.options.baseBackoffMs))
        }
        continue
      }

      try {
        const raw = await verifyFn()
        const ok = typeof raw === 'boolean' ? raw : raw.ok
        const detail = typeof raw === 'boolean' ? undefined : raw.detail
        if (ok) {
          result.status = 'success'
          result.error = null
          this.options.onProgress?.(`[Ralph] ${taskId} 검증 통과`)
          break
        }
        result.error = detail || 'verification failed'
        this.options.onProgress?.(`[Ralph] ${taskId} 검증 실패: ${result.error}`)
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error)
        this.options.onProgress?.(`[Ralph] ${taskId} 검증 예외: ${result.error}`)
      }

      if (attempt < this.options.maxRetries) {
        await this.sleep(backoffMs(attempt, this.options.baseBackoffMs))
      }
    }

    if (result.status !== 'success') {
      result.status = 'failed'
      this.options.onProgress?.(`[Ralph] ${taskId} ${this.options.maxRetries}회 실패`)
    }

    result.duration = Date.now() - startTime
    this.results.set(taskId, result)
    return result
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  getResult(taskId: string): RalphResult | undefined {
    return this.results.get(taskId)
  }

  summary(): string {
    const total = this.results.size
    const success = Array.from(this.results.values()).filter((r) => r.status === 'success').length
    return `Ralph Loop: ${success}/${total} 성공`
  }
}

export function createRalphLoop(options?: Partial<RalphOptions>): RalphLoop {
  return new RalphLoop(options)
}
