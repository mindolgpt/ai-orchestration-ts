import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import { fileURLToPath } from 'url'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveProjectRoot, resolveVaultRoot, resolveIndexDir } from '@/knowledge/paths'
import { ObsidianVault } from '@/knowledge/vault'
import { listSessionRuntimes } from '@/mcp/session-runtime'
import {
  detectHarnessTarget,
  findForeignHarnessFiles,
  HARNESS_FILES_BY_TARGET,
  HarnessTargetDetection,
} from '@/harness/detect-target'
import { HarnessTarget } from '@/harness/types'

const execFileAsync = promisify(execFile)

export type DoctorSeverity = 'ok' | 'warn' | 'fail'

export interface DoctorCheck {
  id: string
  severity: DoctorSeverity
  message: string
  detail?: string
  fix?: string
}

export interface DoctorReport {
  ok: boolean
  project_root: string
  vault_root: string
  package_version: string
  harness_target: HarnessTarget
  harness_target_source: HarnessTargetDetection['source']
  harness_target_hint?: string
  foreign_harness_files: Array<{ target: HarnessTarget; rel: string; label: string }>
  checks: DoctorCheck[]
  next_steps: string[]
  onboarding_minutes: number
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  const bin = process.platform === 'win32' ? 'where' : 'which'
  try {
    await execFileAsync(bin, [cmd], { timeout: 1500 })
    return true
  } catch {
    return false
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

export async function runDoctor(opts?: {
  vault?: string
  projectRoot?: string
  skipEmbedTest?: boolean
  /** Skip PATH probes (rg / session binary) — for dashboard / frequent polls. */
  quick?: boolean
}): Promise<DoctorReport> {
  const projectRoot = path.resolve(opts?.projectRoot || resolveProjectRoot())
  // Align with CLI/MCP: explicit → env → vaults.yaml → <project>/vault
  const prevRoot = process.env.AIO_PROJECT_ROOT
  if (opts?.projectRoot) process.env.AIO_PROJECT_ROOT = projectRoot
  let vaultRoot: string
  try {
    vaultRoot = resolveVaultRoot(opts?.vault)
  } finally {
    if (opts?.projectRoot) {
      if (prevRoot === undefined) delete process.env.AIO_PROJECT_ROOT
      else process.env.AIO_PROJECT_ROOT = prevRoot
    }
  }
  const checks: DoctorCheck[] = []
  const next_steps: string[] = []

  // Node
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10)
  checks.push({
    id: 'node',
    severity: nodeMajor >= 20 ? 'ok' : 'fail',
    message: `Node.js ${process.versions.node}`,
    fix: nodeMajor < 20 ? 'Upgrade to Node.js >= 20' : undefined,
  })

  // Project root env
  const aioRoot = process.env.AIO_PROJECT_ROOT
  if (aioRoot && path.resolve(aioRoot) !== projectRoot) {
    checks.push({
      id: 'aio_project_root',
      severity: 'warn',
      message: `AIO_PROJECT_ROOT=${aioRoot} differs from detected ${projectRoot}`,
      fix: 'Align AIO_PROJECT_ROOT with your workspace folder in MCP config',
    })
  } else if (!aioRoot) {
    checks.push({
      id: 'aio_project_root',
      severity: 'warn',
      message: 'AIO_PROJECT_ROOT not set (using cwd walk-up detection)',
      fix: 'Set env AIO_PROJECT_ROOT in .cursor/mcp.json: "${workspaceFolder}"',
    })
  } else {
    checks.push({
      id: 'aio_project_root',
      severity: 'ok',
      message: `AIO_PROJECT_ROOT=${projectRoot}`,
    })
  }

  // Vault
  const vaultOk = await pathExists(vaultRoot)
  checks.push({
    id: 'vault',
    severity: vaultOk ? 'ok' : 'fail',
    message: vaultOk ? `Vault: ${vaultRoot}` : `Vault missing: ${vaultRoot}`,
    fix: vaultOk ? undefined : 'Run: aio init',
  })
  if (!vaultOk) next_steps.push('aio init')

  let wikiPages = 0
  if (vaultOk) {
    try {
      const vault = new ObsidianVault(vaultRoot)
      await vault.initialize()
      const notes = await vault.listNotes()
      wikiPages = notes.filter((n) => n.startsWith('wiki/')).length
      checks.push({
        id: 'wiki_pages',
        severity: wikiPages >= 3 ? 'ok' : wikiPages > 0 ? 'warn' : 'warn',
        message: `Wiki pages: ${wikiPages}`,
        detail:
          wikiPages < 3 ? 'brainstorm/query quality improves with more domain wiki' : undefined,
        fix: wikiPages < 3 ? 'ingest_source or copy domain notes into vault/wiki/' : undefined,
      })
    } catch (err) {
      checks.push({
        id: 'wiki_pages',
        severity: 'warn',
        message: 'Could not list wiki notes',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Index / vector store
  const indexDir = resolveIndexDir(vaultRoot)
  const { resolveVectorStoreKind } = await import('@/knowledge/vector-store')
  const storeKind = resolveVectorStoreKind()
  let indexReadyForEmbed = false
  if (storeKind === 'faiss') {
    const metaPath = path.join(indexDir, 'meta.json')
    const faissPath = path.join(indexDir, 'index.faiss')
    const hasMeta = await pathExists(metaPath)
    const hasFaiss = await pathExists(faissPath)
    indexReadyForEmbed = hasMeta
    checks.push({
      id: 'search_index',
      severity: hasMeta && hasFaiss ? 'ok' : hasMeta ? 'warn' : 'fail',
      message:
        hasMeta && hasFaiss ? `Search index (faiss): ${indexDir}` : `Index incomplete: ${indexDir}`,
      fix: !hasMeta ? 'Run: aio init (or recall once to build index)' : undefined,
    })
  } else {
    const probe = await probeRemoteVectorStore(storeKind)
    indexReadyForEmbed = probe.ok
    checks.push({
      id: 'search_index',
      severity: probe.ok ? 'ok' : 'fail',
      message: probe.message,
      detail: probe.detail,
      fix: probe.ok ? undefined : probe.fix,
    })
  }

  // Harness
  const harnessFiles = [
    { id: 'agents_md', path: path.join(projectRoot, 'AGENTS.md'), cmd: 'aio bootstrap-harness' },
    {
      id: 'cursor_rule',
      path: path.join(projectRoot, '.cursor', 'rules', 'aio-domain-harness.mdc'),
      cmd: 'aio bootstrap-harness',
    },
    {
      id: 'domain_profile',
      path: path.join(projectRoot, '.aio', 'domain-profile.yaml'),
      cmd: 'aio bootstrap-harness',
    },
  ]
  for (const h of harnessFiles) {
    const exists = await pathExists(h.path)
    checks.push({
      id: h.id,
      severity: exists ? 'ok' : 'warn',
      message: exists
        ? path.relative(projectRoot, h.path)
        : `Missing: ${path.relative(projectRoot, h.path)}`,
      fix: exists ? undefined : `Run: ${h.cmd}`,
    })
  }
  if (!(await pathExists(path.join(projectRoot, 'AGENTS.md')))) {
    next_steps.push('aio bootstrap-harness')
  }

  // Harness target auto-detect + foreign files
  const targetDetection = await detectHarnessTarget(projectRoot)
  const active = targetDetection.target as Exclude<HarnessTarget, 'all'>
  checks.push({
    id: 'harness_target',
    severity: targetDetection.source === 'fallback' ? 'warn' : 'ok',
    message: `Active harness target: ${active} (${targetDetection.source})`,
    detail: targetDetection.hint,
    fix:
      targetDetection.source === 'fallback'
        ? 'Set AIO_HARNESS_TARGET=cursor|claude|... in MCP env'
        : undefined,
  })

  const foreign = await findForeignHarnessFiles(projectRoot, active)
  for (const f of foreign) {
    checks.push({
      id: `foreign_${f.target}_${f.rel.replace(/[^\w]/g, '_')}`,
      severity: 'warn',
      message: `Unnecessary for ${active}: ${f.rel} (${f.label}, ${f.target})`,
      fix: `Delete or: aio bootstrap-harness --prune-foreign`,
    })
  }
  if (foreign.length) {
    next_steps.push(
      `Remove ${foreign.length} foreign harness file(s): aio bootstrap-harness --prune-foreign`
    )
  }

  // Per-target harness completeness
  for (const f of HARNESS_FILES_BY_TARGET[active]) {
    const exists = await pathExists(path.join(projectRoot, f.rel))
    checks.push({
      id: `harness_${f.rel.replace(/[^\w]/g, '_')}`,
      severity: exists ? 'ok' : 'warn',
      message: exists ? `${active}: ${f.rel}` : `Missing ${active} artifact: ${f.rel}`,
      fix: exists ? undefined : `aio bootstrap-harness --force`,
    })
  }

  if (active === 'opencode') {
    const plugin = path.join(projectRoot, '.opencode', 'plugins', 'aio-harness.mjs')
    checks.push({
      id: 'opencode_plugin',
      severity: (await pathExists(plugin)) ? 'ok' : 'warn',
      message: (await pathExists(plugin))
        ? 'OpenCode aio-harness plugin present'
        : 'Missing .opencode/plugins/aio-harness.mjs',
      fix: (await pathExists(plugin)) ? undefined : 'aio bootstrap-harness --force',
    })
  }

  if (active === 'codex') {
    const hooks = path.join(projectRoot, '.codex', 'hooks.json')
    checks.push({
      id: 'codex_hooks',
      severity: (await pathExists(hooks)) ? 'ok' : 'warn',
      message: (await pathExists(hooks)) ? 'Codex hooks.json present' : 'Missing .codex/hooks.json',
      fix: (await pathExists(hooks))
        ? undefined
        : 'aio bootstrap-harness --force; trust via /hooks in Codex',
    })
  }

  // Domain profile stack
  try {
    const profileRaw = await fs.readFile(
      path.join(projectRoot, '.aio', 'domain-profile.yaml'),
      'utf-8'
    )
    const hasStack = /backend:|frontend:|infra:/.test(profileRaw)
    checks.push({
      id: 'domain_profile_stack',
      severity: hasStack ? 'ok' : 'warn',
      message: hasStack
        ? 'domain-profile stack fields present'
        : 'domain-profile.yaml stack is empty',
      fix: hasStack
        ? undefined
        : 'Run seed_stack_playbooks or bootstrap-harness with --backend/--frontend',
    })
  } catch {
    /* profile missing handled above */
  }

  // MCP config
  const mcpPath = path.join(projectRoot, '.cursor', 'mcp.json')
  const mcp = await readJsonSafe<{
    mcpServers?: Record<string, { command?: string; args?: string[] }>
  }>(mcpPath)
  const hasAioMcp =
    mcp?.mcpServers &&
    Object.entries(mcp.mcpServers).some(
      ([, s]) =>
        s.args?.some((a) => a.includes('aio-mcp') || a.includes('@mindol1004/aio-mcp')) ||
        s.command === 'aio'
    )
  checks.push({
    id: 'cursor_mcp',
    severity: hasAioMcp ? 'ok' : mcp ? 'warn' : 'warn',
    message: hasAioMcp
      ? '.cursor/mcp.json includes aio-mcp'
      : mcp
        ? '.cursor/mcp.json exists but aio-mcp server not found'
        : 'No .cursor/mcp.json (bootstrap-harness can merge it)',
    fix: hasAioMcp ? undefined : 'aio bootstrap-harness && reload MCP in Cursor',
  })

  // Git
  const gitDir = path.join(projectRoot, '.git')
  checks.push({
    id: 'git',
    severity: (await pathExists(gitDir)) ? 'ok' : 'warn',
    message: (await pathExists(gitDir))
      ? 'Git repository detected'
      : 'Not a git repo (worktree/branch hunt limited)',
    fix: (await pathExists(gitDir)) ? undefined : 'git init (optional, for worktree isolation)',
  })

  // ripgrep + session runtime (PATH probes — skip in quick/dashboard mode)
  if (!opts?.quick) {
    const [hasRg, sessionBinOk] = await Promise.all([
      commandExists('rg'),
      (async () => {
        const runtime = process.env.AIO_SESSION_RUNTIME || 'opencode'
        const runtimes = listSessionRuntimes()
        const spec = runtimes.find((r) => r.id === runtime) || runtimes[0]
        return { runtime, command: spec.command, ok: await commandExists(spec.command) }
      })(),
    ])
    checks.push({
      id: 'ripgrep',
      severity: hasRg ? 'ok' : 'warn',
      message: hasRg ? 'ripgrep (rg) available' : 'ripgrep not found',
      fix: hasRg ? undefined : 'Install ripgrep or set AIO_DISABLE_RG=1',
    })
    checks.push({
      id: 'session_runtime',
      severity: sessionBinOk.ok ? 'ok' : 'warn',
      message: sessionBinOk.ok
        ? `Session runtime: ${sessionBinOk.runtime} (${sessionBinOk.command})`
        : `Session binary missing: ${sessionBinOk.command} (runtime=${sessionBinOk.runtime})`,
      fix: sessionBinOk.ok
        ? undefined
        : `Install ${sessionBinOk.command} or set AIO_SESSION_RUNTIME / AIO_SESSION_COMMAND`,
    })
  } else {
    const runtime = process.env.AIO_SESSION_RUNTIME || 'opencode'
    checks.push({
      id: 'session_runtime',
      severity: 'ok',
      message: `Session runtime: ${runtime} (PATH probe skipped)`,
    })
  }

  // Embedding
  const embedProvider = process.env.EMBEDDING_PROVIDER || 'local'
  if (embedProvider === 'openai' && !process.env.OPENAI_API_KEY) {
    checks.push({
      id: 'embedding',
      severity: 'fail',
      message: 'EMBEDDING_PROVIDER=openai but OPENAI_API_KEY missing',
      fix: 'Set OPENAI_API_KEY or EMBEDDING_PROVIDER=local',
    })
  } else {
    checks.push({
      id: 'embedding',
      severity: 'ok',
      message: `Embedding: ${embedProvider}${embedProvider === 'local' ? ' (first recall may download model)' : ''}`,
    })
  }

  // Optional embed smoke (skip in tests)
  if (!opts?.skipEmbedTest && vaultOk && indexReadyForEmbed) {
    try {
      const { createEmbedder } = await import('@/knowledge/embedder')
      const emb = createEmbedder()
      await emb.embedOne('doctor smoke test')
      checks.push({ id: 'embed_smoke', severity: 'ok', message: 'Embedder smoke test passed' })
    } catch (err) {
      checks.push({
        id: 'embed_smoke',
        severity: 'warn',
        message: 'Embedder smoke test failed',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const fails = checks.filter((c) => c.severity === 'fail').length
  const ok = fails === 0

  if (!next_steps.includes('aio init') && wikiPages < 3) {
    next_steps.push('Add 3+ wiki pages (ingest_source) for domain-aware brainstorm')
  }
  if (hasAioMcp) next_steps.push('Reload MCP in Cursor after config changes')
  next_steps.push('Test: aio aio-prompt "wiki lint" --execute')
  next_steps.push('Chat: brainstorm_design / bootstrap_domain with your task')

  let pkgVersion = 'unknown'
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const candidates = [
      path.join(here, '..', 'package.json'),
      path.join(here, '..', '..', 'package.json'),
      path.join(process.cwd(), 'package.json'),
    ]
    for (const c of candidates) {
      if (!fsSync.existsSync(c)) continue
      const pkg = JSON.parse(fsSync.readFileSync(c, 'utf-8')) as { version?: string; name?: string }
      if (pkg.name === '@mindol1004/aio-mcp' || pkg.version) {
        pkgVersion = pkg.version || pkgVersion
        if (pkg.name === '@mindol1004/aio-mcp') break
      }
    }
  } catch {
    /* ignore */
  }

  return {
    ok,
    project_root: projectRoot,
    vault_root: vaultRoot,
    package_version: pkgVersion,
    harness_target: targetDetection.target,
    harness_target_source: targetDetection.source,
    harness_target_hint: targetDetection.hint,
    foreign_harness_files: foreign,
    checks,
    next_steps: [...new Set(next_steps)],
    onboarding_minutes: 5,
  }
}

async function probeRemoteVectorStore(
  kind: string
): Promise<{ ok: boolean; message: string; detail?: string; fix?: string }> {
  const fixBase = 'Fix env or unset VECTOR_STORE to use local FAISS'
  try {
    if (kind === 'qdrant') {
      const url = (process.env.QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/$/, '')
      const res = await fetch(`${url}/readyz`, {
        headers: process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : undefined,
      })
      return {
        ok: res.ok,
        message: res.ok ? `Vector store: qdrant (${url})` : `Qdrant not ready (${res.status})`,
        fix: res.ok ? undefined : fixBase,
      }
    }
    if (kind === 'chroma') {
      const url = (process.env.CHROMA_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
      let res = await fetch(`${url}/api/v2/heartbeat`).catch(() => null)
      if (!res || !res.ok) res = await fetch(`${url}/api/v1/heartbeat`).catch(() => null)
      const ok = !!res?.ok
      return {
        ok,
        message: ok ? `Vector store: chroma (${url})` : `Chroma not ready at ${url}`,
        fix: ok ? undefined : fixBase,
      }
    }
    if (kind === 'weaviate') {
      const url = (process.env.WEAVIATE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')
      const res = await fetch(`${url}/v1/.well-known/ready`)
      return {
        ok: res.ok,
        message: res.ok ? `Vector store: weaviate (${url})` : `Weaviate not ready at ${url}`,
        fix: res.ok ? undefined : fixBase,
      }
    }
    if (kind === 'pinecone') {
      const key = process.env.PINECONE_API_KEY?.trim()
      if (!key) {
        return { ok: false, message: 'Pinecone: PINECONE_API_KEY missing', fix: fixBase }
      }
      const res = await fetch('https://api.pinecone.io/indexes', {
        headers: { 'Api-Key': key, 'X-Pinecone-Api-Version': '2025-01' },
      })
      return {
        ok: res.ok,
        message: res.ok
          ? `Vector store: pinecone (index=${process.env.PINECONE_INDEX || 'auto'})`
          : `Pinecone API error (${res.status})`,
        fix: res.ok ? undefined : fixBase,
      }
    }
    if (kind === 'pgvector') {
      const connectionString =
        process.env.DATABASE_URL?.trim() ||
        process.env.PGVECTOR_URL?.trim() ||
        process.env.POSTGRES_URL?.trim()
      if (!connectionString) {
        return { ok: false, message: 'pgvector: DATABASE_URL missing', fix: fixBase }
      }
      try {
        const pg = await import('pg')
        const Pool =
          pg.Pool || (pg as unknown as { default: { Pool: typeof pg.Pool } }).default?.Pool
        if (!Pool) throw new Error('pg.Pool missing — npm i pg')
        const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 })
        try {
          await pool.query('SELECT 1')
          return { ok: true, message: 'Vector store: pgvector (DATABASE_URL)' }
        } finally {
          await pool.end().catch(() => undefined)
        }
      } catch (err) {
        return {
          ok: false,
          message: 'pgvector connection failed',
          detail: err instanceof Error ? err.message : String(err),
          fix: 'Install pg (`npm i pg`), enable CREATE EXTENSION vector, check DATABASE_URL',
        }
      }
    }
    return { ok: false, message: `Unknown VECTOR_STORE=${kind}`, fix: fixBase }
  } catch (err) {
    return {
      ok: false,
      message: `Vector store ${kind} unreachable`,
      detail: err instanceof Error ? err.message : String(err),
      fix: fixBase,
    }
  }
}

export const ONBOARDING_CHECKLIST = [
  { step: 1, cmd: 'npx -y @mindol1004/aio-mcp init', note: 'vault + search index' },
  {
    step: 2,
    cmd: 'npx -y @mindol1004/aio-mcp bootstrap-harness',
    note: 'AGENTS.md, Cursor rules/hooks, mcp.json',
  },
  {
    step: 3,
    cmd: 'Connect MCP in Cursor (.cursor/mcp.json) + reload',
    note: 'AIO_PROJECT_ROOT=${workspaceFolder}',
  },
  { step: 4, cmd: 'npx -y @mindol1004/aio-mcp doctor', note: 'verify all checks green/warn-only' },
  {
    step: 5,
    cmd: 'aio ingest --file README.md',
    note: 'ingest pipeline raw→wiki→lint',
  },
  { step: 6, cmd: 'aio aio-prompt "wiki lint" --execute', note: 'keyword routing smoke test' },
] as const
