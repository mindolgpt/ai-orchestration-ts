/**
 * Resolve how to spawn an isolated child AI session.
 * Env:
 *   AIO_SESSION_RUNTIME = opencode | claude | cursor | codex | custom  (default: opencode)
 *   AIO_SESSION_COMMAND  = override binary (or custom binary)
 *   AIO_SESSION_ARGS     = JSON array; "{{prompt}}" replaced with the prompt string
 *     e.g. ["-p","{{prompt}}"] or ["run","{{prompt}}"]
 */

export type SessionRuntime = 'opencode' | 'claude' | 'cursor' | 'codex' | 'custom'

export interface SessionSpawnSpec {
  runtime: SessionRuntime
  command: string
  args: string[]
}

export interface ResolveSessionSpawnOptions {
  runtime?: string
  command?: string
  argsPrefix?: string[]
  /** Raw args template; "{{prompt}}" placeholders are replaced */
  argsTemplate?: string[]
}

const DEFAULTS: Record<Exclude<SessionRuntime, 'custom'>, { command: string; args: string[] }> = {
  opencode: { command: 'opencode', args: ['run', '{{prompt}}'] },
  claude: { command: 'claude', args: ['-p', '{{prompt}}'] },
  cursor: { command: 'agent', args: ['-p', '{{prompt}}'] },
  codex: { command: 'codex', args: ['exec', '{{prompt}}'] },
}

function normalizeRuntime(raw?: string): SessionRuntime {
  const v = (raw || process.env.AIO_SESSION_RUNTIME || 'opencode').toLowerCase().trim()
  if (v === 'opencode' || v === 'claude' || v === 'cursor' || v === 'codex' || v === 'custom') {
    return v
  }
  return 'opencode'
}

function applyPrompt(template: string[], prompt: string): string[] {
  return template.map((a) => a.split('{{prompt}}').join(prompt))
}

function parseArgsEnv(): string[] | undefined {
  const raw = process.env.AIO_SESSION_ARGS
  if (!raw?.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed
    }
  } catch {
    /* ignore */
  }
  return undefined
}

export function resolveSessionSpawn(
  prompt: string,
  opts?: ResolveSessionSpawnOptions
): SessionSpawnSpec {
  const runtime = normalizeRuntime(opts?.runtime)
  const envCommand = process.env.AIO_SESSION_COMMAND
  const envArgs = parseArgsEnv()

  if (opts?.command || opts?.argsPrefix) {
    return {
      runtime: opts.command ? 'custom' : runtime,
      command: opts.command || envCommand || DEFAULTS.opencode.command,
      args: [...(opts.argsPrefix || ['run']), prompt],
    }
  }

  if (runtime === 'custom' || envArgs) {
    const command = opts?.command || envCommand || 'opencode'
    const template = opts?.argsTemplate || envArgs || ['run', '{{prompt}}']
    return { runtime: 'custom', command, args: applyPrompt(template, prompt) }
  }

  if (envCommand && !opts?.runtime && !process.env.AIO_SESSION_RUNTIME) {
    // Legacy: AIO_SESSION_COMMAND alone overrides binary but keeps run <prompt>
    return {
      runtime: 'custom',
      command: envCommand,
      args: applyPrompt(envArgs || ['run', '{{prompt}}'], prompt),
    }
  }

  // custom already returned above — runtime is a DEFAULTS key here
  const def = DEFAULTS[runtime]
  const command = envCommand || def.command
  const template = opts?.argsTemplate || envArgs || def.args
  return { runtime, command, args: applyPrompt(template, prompt) }
}

export function listSessionRuntimes(): Array<{
  id: SessionRuntime
  command: string
  args: string[]
}> {
  return (Object.keys(DEFAULTS) as Array<Exclude<SessionRuntime, 'custom'>>).map((id) => ({
    id,
    command: DEFAULTS[id].command,
    args: DEFAULTS[id].args,
  }))
}
