/**
 * Resolve how to spawn an isolated child AI session.
 *
 * Built-in runtimes: opencode, claude, cursor, codex
 *
 * Custom runtimes via environment variables (no source code modification needed):
 *   AIO_RUNTIME_<NAME>_COMMAND = path or name of the CLI binary
 *   AIO_RUNTIME_<NAME>_ARGS    = JSON array of argument tokens; "{{prompt}}" is replaced
 *     e.g. AIO_RUNTIME_ZCODE_COMMAND=npx
 *          AIO_RUNTIME_ZCODE_ARGS=["-y","@mindol1004/aio-mcp","run","{{prompt}}"]
 *
 * Fallback env vars (legacy):
 *   AIO_SESSION_RUNTIME  = runtime name (any string; unknown names treated as 'custom')
 *   AIO_SESSION_COMMAND  = override binary
 *   AIO_SESSION_ARGS     = JSON array; "{{prompt}}" placeholders are replaced
 */

export type SessionRuntime = string

export interface SessionSpawnSpec {
  runtime: string
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

/** Built-in runtimes shipped with the codebase. */
const BUILT_INS: Record<string, { command: string; args: string[] }> = {
  opencode: { command: 'opencode', args: ['run', '{{prompt}}'] },
  claude: { command: 'claude', args: ['-p', '{{prompt}}'] },
  cursor: { command: 'agent', args: ['-p', '{{prompt}}'] },
  codex: { command: 'codex', args: ['exec', '{{prompt}}'] },
}

const BUILT_IN_NAMES = new Set(Object.keys(BUILT_INS))

/**
 * Load custom runtimes from environment variables.
 *
 * Pattern: AIO_RUNTIME_<NAME>_COMMAND + AIO_RUNTIME_<NAME>_ARGS (optional)
 *
 * Example:
 *   AIO_RUNTIME_ZCODE_COMMAND=npx
 *   AIO_RUNTIME_ZCODE_ARGS=["-y","@mindol1004/aio-mcp","mcp-serve"]
 */
function loadCustomRuntimes(): Record<string, { command: string; args: string[] }> {
  const custom: Record<string, { command: string; args: string[] }> = {}
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^AIO_RUNTIME_([A-Z0-9_]+)_COMMAND$/)
    if (!match || !value) continue
    const name = match[1].toLowerCase()
    const argsKey = `AIO_RUNTIME_${match[1]}_ARGS`
    const argsRaw = process.env[argsKey]
    let args: string[] = ['{{prompt}}']
    if (argsRaw) {
      try {
        const parsed = JSON.parse(argsRaw) as unknown
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
          args = parsed
        }
      } catch {
        /* ignore invalid JSON, use default */
      }
    }
    custom[name] = { command: value, args }
  }
  return custom
}

/** Merge built-in + env-configured custom runtimes into one lookup. */
function allRuntimes(): Record<string, { command: string; args: string[] }> {
  return { ...BUILT_INS, ...loadCustomRuntimes() }
}

/** Normalize runtime name: built-in names pass through; everything else becomes 'custom'. */
function normalizeRuntime(raw?: string): string {
  const value = (raw || process.env.AIO_SESSION_RUNTIME || 'opencode').toLowerCase().trim()
  if (BUILT_IN_NAMES.has(value)) return value
  // Check env-registered custom runtimes
  const custom = loadCustomRuntimes()
  if (custom[value]) return value
  // If AIO_SESSION_RUNTIME is set explicitly, honor it as custom even if no env registered
  if (raw || process.env.AIO_SESSION_RUNTIME) return 'custom'
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

/**
 * Resolve the command + args needed to spawn a child AI session.
 *
 * Resolution priority (first match wins):
 *   1. opts.command / opts.argsPrefix (explicit override → runtime='custom')
 *   2. runtime is a BUILT_IN → use that definition
 *   3. runtime is registered via AIO_RUNTIME_<NAME>_COMMAND env → use that
 *   4. runtime='custom' or AIO_SESSION_ARGS set → use env command/template
 *   5. AIO_SESSION_COMMAND env set (legacy) → use with 'run'
 *   6. Fall back to 'opencode' default
 */
export function resolveSessionSpawn(
  prompt: string,
  opts?: ResolveSessionSpawnOptions
): SessionSpawnSpec {
  const runtime = normalizeRuntime(opts?.runtime)
  const envCommand = process.env.AIO_SESSION_COMMAND
  const envArgs = parseArgsEnv()
  const customRuntimes = loadCustomRuntimes()

  // Priority 1: Explicit command / argsPrefix override
  if (opts?.command || opts?.argsPrefix) {
    return {
      runtime: 'custom',
      command: opts.command || envCommand || 'opencode',
      args: [...(opts.argsPrefix || ['run']), prompt],
    }
  }

  // Priority 2: Built-in runtime
  if (BUILT_IN_NAMES.has(runtime)) {
    const def = BUILT_INS[runtime]
    const command = envCommand || def.command
    const template = opts?.argsTemplate || envArgs || def.args
    return { runtime, command, args: applyPrompt(template, prompt) }
  }

  // Priority 3: Env-registered custom runtime (AIO_RUNTIME_<NAME>_COMMAND)
  if (customRuntimes[runtime]) {
    const def = customRuntimes[runtime]
    const command = envCommand || def.command
    const template = opts?.argsTemplate || envArgs || def.args
    return { runtime, command, args: applyPrompt(template, prompt) }
  }

  // Priority 4: 'custom' runtime with env command/template
  if (runtime === 'custom' || envArgs) {
    const command = opts?.command || envCommand || 'opencode'
    const template = opts?.argsTemplate || envArgs || ['run', '{{prompt}}']
    return { runtime: 'custom', command, args: applyPrompt(template, prompt) }
  }

  // Priority 5: Legacy AIO_SESSION_COMMAND alone
  if (envCommand && !opts?.runtime && !process.env.AIO_SESSION_RUNTIME) {
    return {
      runtime: 'custom',
      command: envCommand,
      args: applyPrompt(envArgs || ['run', '{{prompt}}'], prompt),
    }
  }

  // Priority 6: Fallback to opencode
  const def = BUILT_INS.opencode
  return { runtime: 'opencode', command: envCommand || def.command, args: def.args }
}

/**
 * List all available session runtimes (built-in + env-registered custom).
 */
export function listSessionRuntimes(): Array<{
  id: string
  command: string
  args: string[]
}> {
  const runtimes = allRuntimes()
  return Object.entries(runtimes).map(([id, def]) => ({
    id,
    command: def.command,
    args: def.args,
  }))
}
