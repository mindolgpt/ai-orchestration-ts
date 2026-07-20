import * as fs from 'fs'
import * as path from 'path'
import yaml from 'js-yaml'

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'composer.json',
] as const

/**
 * Resolve the active project root for vault placement.
 * Priority: explicit env → walk up from cwd (skip bare home) → cwd.
 */
export function resolveProjectRoot(): string {
  const fromEnv =
    process.env.AIO_PROJECT_ROOT || process.env.CURSOR_PROJECT_DIR || process.env.WORKSPACE_FOLDER

  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv)
  }

  const home = path.resolve(process.env.HOME || process.env.USERPROFILE || '')
  let dir = path.resolve(process.cwd())
  const { root } = path.parse(dir)

  // Walk up until filesystem root
  for (;;) {
    const isHome = home !== '' && path.resolve(dir) === home
    const hasMarker = PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))

    // Home often has ~/.cursor — do not treat home as the project unless it has a real marker.
    if (hasMarker && !isHome) {
      return dir
    }
    if (
      hasMarker &&
      isHome &&
      (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json')))
    ) {
      return dir
    }

    if (dir === root) break
    dir = path.dirname(dir)
  }

  return path.resolve(process.cwd())
}

interface VaultRegistryEntry {
  path: string
}

function loadVaultRegistrySync(projectRoot: string): {
  default: string
  vaults: Record<string, VaultRegistryEntry>
} | null {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.aio', 'vaults.yaml'), 'utf-8')
    const parsed = yaml.load(raw) as {
      default?: string
      vaults?: Record<string, VaultRegistryEntry>
    }
    if (parsed?.vaults && typeof parsed.vaults === 'object') {
      return {
        default: parsed.default || Object.keys(parsed.vaults)[0] || 'main',
        vaults: parsed.vaults,
      }
    }
  } catch {
    /* no registry */
  }
  return null
}

function resolveVaultPathFromRegistry(
  projectRoot: string,
  name: string,
  reg: { vaults: Record<string, VaultRegistryEntry> }
): string | null {
  const entry = reg.vaults[name]
  if (!entry) return null
  return path.isAbsolute(entry.path) ? entry.path : path.join(projectRoot, entry.path)
}

/**
 * Resolve Obsidian/wiki vault directory.
 * Priority: explicit arg → AIO_VAULT_PATH / OBSIDIAN_VAULT_PATH → AIO_VAULT_NAME + vaults.yaml → registry default → <projectRoot>/vault
 */
export function resolveVaultRoot(explicit?: string): string {
  if (explicit?.trim()) {
    return path.resolve(explicit.trim())
  }

  const fromEnv = process.env.AIO_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH
  if (fromEnv?.trim()) {
    return path.resolve(fromEnv.trim())
  }

  const projectRoot = resolveProjectRoot()
  const reg = loadVaultRegistrySync(projectRoot)
  if (reg) {
    const named = process.env.AIO_VAULT_NAME?.trim()
    if (named) {
      const resolved = resolveVaultPathFromRegistry(projectRoot, named, reg)
      if (resolved) return resolved
    }
    const fromDefault = resolveVaultPathFromRegistry(projectRoot, reg.default, reg)
    if (fromDefault) return fromDefault
  }

  return path.join(projectRoot, 'vault')
}

export function resolveIndexDir(vaultRoot: string): string {
  return path.join(vaultRoot, '.index')
}

/** Normalize relative vault paths to POSIX style (wiki/foo.md). */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/')
}
