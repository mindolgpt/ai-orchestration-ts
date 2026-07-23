import { RalphAttemptContext } from '@/ralph/types'

/**
 * Build the prompt handed to a child agent for a given Ralph attempt.
 *
 * On the first attempt the base prompt is used as-is. On retries we prepend a
 * focused "fix" preamble that tells the agent exactly which verify/implement
 * step failed and quotes the failure output, so the retry is *informed* rather
 * than a blind re-run of the same instruction.
 */
export function buildRetryPrompt(basePrompt: string, ctx: RalphAttemptContext): string {
  if (!ctx.isRetry || !ctx.previousError) return basePrompt

  const phase = ctx.previousFailurePhase === 'verify' ? 'verification' : 'implementation'
  const detail = ctx.previousError.slice(0, 2000)

  return [
    `# Retry ${ctx.attempt}/${ctx.maxRetries} — previous attempt FAILED`,
    '',
    `The previous attempt failed during **${phase}**. Do NOT restart from scratch.`,
    `Read the failure output below, find the root cause, and make the minimal change to fix it.`,
    '',
    '## Previous failure output',
    '',
    '```',
    detail,
    '```',
    '',
    '## Fix instructions',
    '',
    '- Address the specific error above first (compile/lint/type/test/acceptance).',
    '- Re-run the relevant verify step mentally before reporting done.',
    '- Keep prior working changes; only adjust what is needed to pass.',
    '',
    '---',
    '',
    '# Original task',
    '',
    basePrompt,
  ].join('\n')
}
