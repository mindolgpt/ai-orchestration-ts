import * as fs from 'fs/promises'
import * as path from 'path'
import yaml from 'js-yaml'
import { resolveProjectRoot } from '@/knowledge/paths'

export interface VaultEntry {
  name: string
  path: string
  domain?: string
  description?: string
}

export interface VaultRegistry {
  default: string
  vaults: Record<string, Omit<VaultEntry, 'name'> & { path: string }>
}

const REGISTRY_REL = '.aio/vaults.yaml'

export function vaultRegistryPath(projectRoot?: string): string {
  return path.join(projectRoot || resolveProjectRoot(), REGISTRY_REL)
}

export async function loadVaultRegistry(projectRoot?: string): Promise<VaultRegistry> {
  const root = projectRoot || resolveProjectRoot()
  const regPath = vaultRegistryPath(root)

  try {
    const raw = await fs.readFile(regPath, 'utf-8')
    const parsed = yaml.load(raw) as Partial<VaultRegistry>
    if (parsed?.vaults && typeof parsed.vaults === 'object') {
      return {
        default: parsed.default || Object.keys(parsed.vaults)[0] || 'main',
        vaults: parsed.vaults,
      }
    }
  } catch {
    /* create default below */
  }

  return {
    default: 'main',
    vaults: {
      main: {
        path: 'vault',
        domain: 'general',
        description: 'Primary project vault',
      },
    },
  }
}

export async function saveVaultRegistry(
  registry: VaultRegistry,
  projectRoot?: string
): Promise<string> {
  const p = vaultRegistryPath(projectRoot)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, yaml.dump(registry, { lineWidth: 100 }), 'utf-8')
  return p
}

export async function listVaultEntries(projectRoot?: string): Promise<VaultEntry[]> {
  const root = projectRoot || resolveProjectRoot()
  const reg = await loadVaultRegistry(root)
  return Object.entries(reg.vaults).map(([name, v]) => ({
    name,
    path: path.isAbsolute(v.path) ? v.path : path.join(root, v.path),
    domain: v.domain,
    description: v.description,
  }))
}

export async function resolveNamedVaultRoot(
  nameOrExplicit?: string,
  projectRoot?: string
): Promise<{ name: string; path: string; registry: VaultRegistry }> {
  const root = projectRoot || resolveProjectRoot()
  const reg = await loadVaultRegistry(root)
  const envName = process.env.AIO_VAULT_NAME?.trim()
  const name = nameOrExplicit?.trim() || envName || reg.default || 'main'
  const entry = reg.vaults[name]

  if (!entry) {
    throw new Error(
      `Unknown vault "${name}". Available: ${Object.keys(reg.vaults).join(', ')}. Edit ${REGISTRY_REL}`
    )
  }

  const vaultPath = path.isAbsolute(entry.path) ? entry.path : path.join(root, entry.path)
  return { name, path: vaultPath, registry: reg }
}

export async function registerVault(
  opts: { name: string; path: string; domain?: string; description?: string; default?: boolean },
  projectRoot?: string
): Promise<VaultRegistry> {
  const root = projectRoot || resolveProjectRoot()
  const reg = await loadVaultRegistry(root)
  reg.vaults[opts.name] = {
    path: opts.path,
    domain: opts.domain,
    description: opts.description,
  }
  if (opts.default) reg.default = opts.name
  await saveVaultRegistry(reg, root)
  return reg
}
