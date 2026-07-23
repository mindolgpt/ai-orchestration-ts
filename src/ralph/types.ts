export interface RalphResult {
  taskId: string
  status: 'running' | 'success' | 'failed'
  attempts: number
  output: unknown
  error: string | null
  duration: number
  startedAt: number
}

/**
 * Feedback passed into `implementFn` on each attempt so retries are *informed*
 * (not blind). Attempt 1 has no previous failure; later attempts carry the
 * reason the previous verify/implement failed so the agent can fix it.
 */
export interface RalphAttemptContext {
  /** 1-based attempt number. */
  attempt: number
  /** Total attempts allowed. */
  maxRetries: number
  /** True for attempt > 1. */
  isRetry: boolean
  /** Failure detail from the previous attempt (verify failure or thrown error). */
  previousError: string | null
  /** Which phase produced previousError, if known. */
  previousFailurePhase: 'implement' | 'verify' | null
}
