/**
 * Build env for child AI sessions.
 * Default: allowlist (blocks unrelated secrets). Full passthrough via AIO_CHILD_ENV_PASSTHROUGH=1.
 * Extra keys: AIO_CHILD_ENV_EXTRA=VAR1,VAR2
 */

const EXACT_KEYS = new Set([
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USER',
  'USERNAME',
  'LOGNAME',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SystemRoot',
  'windir',
  'COMSPEC',
  'OS',
  'COMPUTERNAME',
  'HOSTNAME',
  'LANG',
  'LANGUAGE',
  'TERM',
  'TERM_PROGRAM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'SHELL',
  'ComSpec',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'HOMEBREW_PREFIX',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'ELECTRON_RUN_AS_NODE',
  'VSCODE_GIT_IPC_HANDLE',
  'CURSOR_TRACE_ID',
  'CURSOR_AGENT',
  'CURSOR_PROJECT_DIR',
  'CLAUDE_CODE',
  'CLAUDECODE',
  'CLAUDE_SESSION',
  'CLAUDE_PROJECT_DIR',
  'OPENCODE',
  'OPENCODE_CONFIG',
  'CODEX_HOME',
  'CODEX_CLI',
  'WINDSURF',
  'WINDSURF_PROJECT',
  'TZ',
  'EDITOR',
  'VISUAL',
])

const PREFIXES = [
  'AIO_',
  'OPENAI_',
  'ANTHROPIC_',
  'CLAUDE_',
  'CURSOR_',
  'CODEX_',
  'OPENCODE_',
  'GEMINI_',
  'GOOGLE_API_',
  'XAI_',
  'MISTRAL_',
  'GROQ_',
  'AZURE_OPENAI_',
  'NODE_',
  'npm_',
  'NPM_',
  'GIT_',
  'GH_',
  'GITHUB_',
  'LC_',
  'XDG_',
  'ELECTRON_',
  'VSCODE_',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
]

function keyAllowed(key: string): boolean {
  if (EXACT_KEYS.has(key)) return true
  return PREFIXES.some((p) => key.startsWith(p) || key === p.replace(/_$/, ''))
}

export function buildChildEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  if (process.env.AIO_CHILD_ENV_PASSTHROUGH === '1') {
    return { ...process.env, ...stripUndefined(overrides) }
  }

  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (keyAllowed(key)) env[key] = value
  }

  const extra = process.env.AIO_CHILD_ENV_EXTRA
  if (extra) {
    for (const raw of extra.split(',')) {
      const key = raw.trim()
      if (!key) continue
      const val = process.env[key]
      if (val !== undefined) env[key] = val
    }
  }

  return { ...env, ...stripUndefined(overrides) }
}

function stripUndefined(obj: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out
}
