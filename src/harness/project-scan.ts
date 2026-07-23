/**
 * Detect existing source, analyze stack/languages/layout, and build interview prefill.
 */
import * as fs from 'fs/promises'
import * as path from 'path'
import { resolveProjectRoot } from '@/knowledge/paths'
import { detectLanguages, DetectedLanguage } from '@/harness/detect-language'
import { inferStackFromProject } from '@/harness/profile'
import { LanguageId } from '@/harness/language-rules'
import type { TechStackChoice } from '@/harness/tech-stack'
import type { MethodologyId } from '@/harness/architecture-methodology'

export interface ScanEvidence {
  field: string
  value: string
  evidence: string
  confidence: number
}

export interface InterviewPrefill {
  frontend_language?: LanguageId
  backend_language?: LanguageId
  languages?: LanguageId[]
  frontend_tech_stack?: Partial<TechStackChoice>
  backend_tech_stack?: Partial<TechStackChoice>
  frontend_architecture?: MethodologyId
  backend_architecture?: MethodologyId
  package_manager?: 'npm' | 'pnpm' | 'yarn'
  monorepo_tool?: 'npm-workspaces' | 'pnpm-workspaces' | 'turborepo' | 'none'
  formatter?: string
  testing?: string
  evidence: ScanEvidence[]
}

export interface ProjectScanResult {
  has_source: boolean
  project_root: string
  scan_path: string
  languages: DetectedLanguage[]
  stack: { frontend?: string; backend?: string; infra?: string }
  layout_hints: string[]
  methodology_hints: { frontend?: MethodologyId; backend?: MethodologyId }
  analysis_summary?: {
    totalFiles: number
    totalRoutes: number
    totalModels: number
    totalNodes: number
    totalConcepts?: number
    /** Distinct language plugin ids that produced parsed files. */
    languages?: string[]
  }
  as_is_markdown: string
  prefill: InterviewPrefill
  brownfield_hard_rule: string
}

const SOURCE_DIRS = ['src', 'apps', 'frontend', 'backend', 'server', 'web', 'api', 'packages']
const MANIFESTS = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
]

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function detectHasSource(root: string): Promise<boolean> {
  for (const m of MANIFESTS) {
    if (await exists(path.join(root, m))) return true
  }
  for (const d of SOURCE_DIRS) {
    if (await exists(path.join(root, d))) return true
  }
  return false
}

async function detectPackageManager(root: string): Promise<'npm' | 'pnpm' | 'yarn'> {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

async function detectMonorepoTool(
  root: string
): Promise<'npm-workspaces' | 'pnpm-workspaces' | 'turborepo' | 'none'> {
  if (await exists(path.join(root, 'turbo.json'))) return 'turborepo'
  if (await exists(path.join(root, 'pnpm-workspace.yaml'))) return 'pnpm-workspaces'
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf-8')) as {
      workspaces?: unknown
    }
    if (pkg.workspaces) return 'npm-workspaces'
  } catch {
    /* ignore */
  }
  return 'none'
}

async function collectLayoutHints(root: string): Promise<string[]> {
  const hints: string[] = []
  const candidates = [
    'domain',
    'application',
    'infrastructure',
    'features',
    'entities',
    'shared',
    'adapters',
    'ports',
  ]
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue
      const full = path.join(dir, name)
      try {
        const st = await fs.stat(full)
        if (st.isDirectory()) {
          if (candidates.includes(name.toLowerCase())) hints.push(path.relative(root, full))
          await walk(full, depth + 1)
        }
      } catch {
        /* ignore */
      }
    }
  }
  await walk(root, 0)
  return [...new Set(hints)].slice(0, 40)
}

function inferMethodologyFromLayout(hints: string[]): {
  frontend?: MethodologyId
  backend?: MethodologyId
} {
  const joined = hints.join('/').toLowerCase()
  const out: { frontend?: MethodologyId; backend?: MethodologyId } = {}
  if (joined.includes('features') && (joined.includes('/ui') || joined.includes('entities'))) {
    out.frontend = 'feature-sliced'
  } else if (joined.includes('pages') && joined.includes('modules')) {
    out.frontend = 'pages-modules'
  }
  if (
    joined.includes('domain') &&
    joined.includes('application') &&
    joined.includes('infrastructure')
  ) {
    out.backend = 'clean'
  } else if (joined.includes('ports') || joined.includes('adapters')) {
    out.backend = 'hexagonal'
  } else if (joined.includes('controllers') && joined.includes('services')) {
    out.backend = 'layered'
  }
  return out
}

async function readPkgDeps(root: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  } catch {
    return {}
  }
}

function inferTechFromDeps(
  deps: Record<string, string>,
  stack: { frontend?: string; backend?: string }
): {
  fe: Partial<TechStackChoice>
  be: Partial<TechStackChoice>
  evidence: ScanEvidence[]
} {
  const evidence: ScanEvidence[] = []
  const fe: Partial<TechStackChoice> = { side: 'frontend' }
  const be: Partial<TechStackChoice> = { side: 'backend' }
  const has = (n: string) => Object.keys(deps).some((k) => k === n || k.startsWith(n + '/'))

  if (stack.frontend) {
    fe.framework = stack.frontend.replace(/\./g, '')
    evidence.push({
      field: 'frontend_framework',
      value: fe.framework,
      evidence: 'inferred from project manifests',
      confidence: 2,
    })
  } else if (has('next')) {
    fe.framework = 'nextjs'
    evidence.push({
      field: 'frontend_framework',
      value: 'nextjs',
      evidence: 'package.json has next',
      confidence: 3,
    })
  } else if (has('react')) {
    fe.framework = 'react'
    evidence.push({
      field: 'frontend_framework',
      value: 'react',
      evidence: 'package.json has react',
      confidence: 2,
    })
  } else if (has('vue')) {
    fe.framework = 'vue'
  }

  if (has('@tanstack/react-query') || has('react-query')) {
    fe.data_fetching = 'tanstack-query'
    evidence.push({
      field: 'frontend_data_fetching',
      value: 'tanstack-query',
      evidence: 'package.json has @tanstack/react-query',
      confidence: 3,
    })
  }
  if (has('zustand')) fe.state = 'zustand'
  if (has('tailwindcss')) fe.ui = 'tailwind'
  if (has('vitest')) fe.test_unit = 'vitest'
  if (has('@playwright/test')) fe.test_e2e = 'playwright'

  if (stack.backend) {
    be.framework = stack.backend.replace(/\./g, '')
    evidence.push({
      field: 'backend_framework',
      value: be.framework,
      evidence: 'inferred from project manifests',
      confidence: 2,
    })
  } else if (has('@nestjs/core')) {
    be.framework = 'nestjs'
    evidence.push({
      field: 'backend_framework',
      value: 'nestjs',
      evidence: 'package.json has @nestjs/core',
      confidence: 3,
    })
  } else if (has('express')) {
    be.framework = 'express'
  } else if (has('fastify')) {
    be.framework = 'fastify'
  }

  if (has('prisma') || has('@prisma/client')) be.orm = 'prisma'
  if (has('typeorm')) be.orm = 'typeorm'
  if (has('zod')) be.validation = 'zod'
  if (has('class-validator')) be.validation = 'class-validator'

  return { fe, be, evidence }
}

function languageForStack(side: 'frontend' | 'backend', stackId?: string): LanguageId | undefined {
  if (!stackId) return undefined
  const s = stackId.toLowerCase()
  if (/spring|kotlin/.test(s)) return s.includes('kotlin') ? 'kotlin' : 'java'
  if (/fastapi|django|flask/.test(s)) return 'python'
  if (/^go|chi|echo|fiber/.test(s)) return 'go'
  if (/rust|actix|axum/.test(s)) return 'rust'
  if (/next|react|vue|nuxt|nestjs|express|fastify|angular|svelte/.test(s)) return 'typescript'
  return side === 'frontend' ? 'typescript' : undefined
}

export interface ScanProjectOptions {
  /**
   * When true, ingest the AS-IS markdown into the 3-layer vault (raw/ + wiki/ +
   * index + log + vector index) via the canonical pipeline. Defaults to false
   * because embedder init is expensive and has side effects; interview prefill
   * scans don't need it (the bootstrap_product wiki phase drives ingestion).
   */
  ingestToVault?: boolean
}

export async function scanProject(
  projectRoot?: string,
  options?: ScanProjectOptions
): Promise<ProjectScanResult> {
  const root = path.resolve(projectRoot || resolveProjectRoot())
  const aioDir = path.join(root, '.aio')
  const scanPath = path.join(aioDir, 'project-scan.json')
  const has_source = await detectHasSource(root)

  const brownfield_hard_rule =
    'Do not invent folder/module structure that contradicts .aio/project-scan.json layout.'

  if (!has_source) {
    const empty: ProjectScanResult = {
      has_source: false,
      project_root: root,
      scan_path: scanPath,
      languages: [],
      stack: {},
      layout_hints: [],
      methodology_hints: {},
      as_is_markdown: '# AS-IS Codebase\n\nNo existing application source detected (greenfield).\n',
      prefill: { evidence: [] },
      brownfield_hard_rule,
    }
    await fs.mkdir(aioDir, { recursive: true })
    await fs.writeFile(scanPath, JSON.stringify(empty, null, 2), 'utf-8')
    return empty
  }

  const detection = await detectLanguages(root)
  const stack = await inferStackFromProject(root)
  const layout_hints = await collectLayoutHints(root)
  const methodology_hints = inferMethodologyFromLayout(layout_hints)
  const deps = await readPkgDeps(root)
  const { fe, be, evidence: depEvidence } = inferTechFromDeps(deps, stack)
  const package_manager = await detectPackageManager(root)
  const monorepo_tool = await detectMonorepoTool(root)

  let analysis_summary: ProjectScanResult['analysis_summary']
  let routeLines = ''
  let modelLines = ''
  let conceptLines = ''
  try {
    const { analyzeProject } = await import('@/static-analysis')
    const roots = (
      await Promise.all(
        ['src', 'apps', 'frontend', 'backend', 'web', 'api'].map(async (d) =>
          (await exists(path.join(root, d))) ? path.join(root, d) : null
        )
      )
    ).filter((x): x is string => !!x)
    if (roots.length) {
      // Pass detected languages through to the analysis layer so only the
      // matching language plugins run (avoids scanning a Java repo with the
      // TS parser, etc.). Falls back to "all plugins" when detection is empty.
      const detectedLanguages = mapToPluginLanguageIds(detection.languages.map((l) => l.id))
      const result = await analyzeProject(roots.length ? roots : [root], {
        languages: detectedLanguages.length ? detectedLanguages : undefined,
      })
      analysis_summary = {
        totalFiles: result.summary.totalFiles,
        totalRoutes: result.summary.totalRoutes,
        totalModels: result.summary.totalModels,
        totalNodes: result.summary.totalNodes,
        totalConcepts: result.summary.totalConcepts,
        languages: result.summary.languages,
      }
      routeLines = result.routes
        .slice(0, 30)
        .map((r) => `- \`${r.method || 'ANY'} ${r.path}\` (${r.handlerFile})`)
        .join('\n')
      modelLines = result.models
        .slice(0, 30)
        .map((m) => `- \`${m.name}\` (${m.file})`)
        .join('\n')
      conceptLines = result.concepts
        .slice(0, 30)
        .map((c) => `- \`${c.name}\` (${c.kind})${c.file ? ` (${c.file})` : ''}`)
        .join('\n')
    }
  } catch {
    /* analysis optional */
  }

  const feLang =
    languageForStack('frontend', stack.frontend) ||
    detection.languages.find((l) => l.id === 'typescript' || l.id === 'javascript')?.id
  const beLang =
    languageForStack('backend', stack.backend) ||
    detection.languages.find((l) =>
      ['typescript', 'java', 'kotlin', 'python', 'go', 'rust'].includes(l.id)
    )?.id

  if (feLang) fe.language = feLang
  if (beLang) be.language = beLang

  const evidence: ScanEvidence[] = [
    ...depEvidence,
    ...detection.languages.map((l) => ({
      field: 'language',
      value: l.id,
      evidence: l.evidence,
      confidence: l.confidence,
    })),
  ]
  evidence.push({
    field: 'package_manager',
    value: package_manager,
    evidence: 'lockfile / default',
    confidence: 2,
  })

  let formatter = 'auto'
  if (
    (await exists(path.join(root, '.prettierrc'))) ||
    (await exists(path.join(root, '.prettierrc.json')))
  ) {
    formatter = 'prettier'
    evidence.push({
      field: 'formatter',
      value: 'prettier',
      evidence: '.prettierrc present',
      confidence: 3,
    })
  }

  const as_is_markdown = [
    '# AS-IS Codebase',
    '',
    `Scanned: ${new Date().toISOString()}`,
    '',
    '## Detected stack',
    '',
    `- Frontend: ${stack.frontend || 'unknown'}`,
    `- Backend: ${stack.backend || 'unknown'}`,
    `- Package manager: ${package_manager}`,
    `- Monorepo: ${monorepo_tool}`,
    '',
    '## Languages',
    '',
    ...detection.languages.map((l) => `- ${l.label} — ${l.evidence} (confidence ${l.confidence})`),
    '',
    '## Layout hints',
    '',
    ...(layout_hints.length ? layout_hints.map((h) => `- \`${h}\``) : ['- (none)']),
    '',
    '## Methodology hints',
    '',
    `- Frontend: ${methodology_hints.frontend || 'unknown'}`,
    `- Backend: ${methodology_hints.backend || 'unknown'}`,
    '',
    '## Analysis summary',
    '',
    analysis_summary
      ? `- Files: ${analysis_summary.totalFiles}, Nodes: ${analysis_summary.totalNodes}, Routes: ${analysis_summary.totalRoutes}, Models: ${analysis_summary.totalModels}, Concepts: ${analysis_summary.totalConcepts ?? 0}`
      : '- Static analysis unavailable or skipped',
    '',
    analysis_summary?.languages?.length
      ? `- Detected analysis languages: ${analysis_summary.languages.join(', ')}`
      : '',
    '',
    '## Routes (sample)',
    '',
    routeLines || '- (none)',
    '',
    '## Models (sample)',
    '',
    modelLines || '- (none)',
    '',
    '## Domain concepts (sample)',
    '',
    conceptLines || '- (none)',
    '',
    `## Hard rule`,
    '',
    brownfield_hard_rule,
    '',
  ].join('\n')

  const prefill: InterviewPrefill = {
    frontend_language: feLang,
    backend_language: beLang,
    languages: [
      ...new Set(
        [feLang, beLang, ...detection.languages.map((l) => l.id)].filter(Boolean) as LanguageId[]
      ),
    ],
    frontend_tech_stack: fe.framework ? fe : undefined,
    backend_tech_stack: be.framework ? be : undefined,
    frontend_architecture: methodology_hints.frontend,
    backend_architecture: methodology_hints.backend,
    package_manager,
    monorepo_tool,
    formatter,
    testing: fe.test_unit || be.test_unit || 'auto',
    evidence,
  }

  const result: ProjectScanResult = {
    has_source: true,
    project_root: root,
    scan_path: scanPath,
    languages: detection.languages,
    stack,
    layout_hints,
    methodology_hints,
    analysis_summary,
    as_is_markdown,
    prefill,
    brownfield_hard_rule,
  }

  await fs.mkdir(aioDir, { recursive: true })
  await fs.writeFile(scanPath, JSON.stringify(result, null, 2), 'utf-8')

  // Seed AS-IS knowledge into the 3-layer vault (raw/ + wiki/ + index + log +
  // vector index) via the canonical ingest pipeline when a vault exists.
  // Falls back to a direct wiki file write if the vault/search stack is
  // unavailable (e.g. embedding backend not configured) so scans never fail.
  const vaultRoot = path.join(root, 'vault')
  const asIsPath = path.join(vaultRoot, 'wiki', 'as-is-codebase.md')
  let ingested = false
  if (options?.ingestToVault && (await exists(vaultRoot))) {
    try {
      const [
        { ObsidianVault },
        { SemanticSearch },
        { createEmbedder },
        { resolveIndexDir },
        { ingestPipeline },
      ] = await Promise.all([
        import('@/knowledge/vault'),
        import('@/knowledge/search'),
        import('@/knowledge/embedder'),
        import('@/knowledge/paths'),
        import('@/knowledge/wiki-ingest-pipeline'),
      ])
      const vault = new ObsidianVault(vaultRoot)
      await vault.initialize()
      const search = new SemanticSearch(createEmbedder(), {
        indexDir: resolveIndexDir(vault.rootPath),
        vaultRoot: vault.rootPath,
      })
      await ingestPipeline(vault, search, {
        title: 'AS-IS Codebase',
        content: as_is_markdown,
        source_uri: scanPath,
        concepts: [
          {
            title: 'AS-IS Codebase',
            content: as_is_markdown,
            subdir: 'architecture',
            tags: ['as-is', 'scan'],
            summary: `Scanned ${stack.frontend || 'unknown'} / ${stack.backend || 'unknown'} stack`,
          },
        ],
        lint_mode: 'none',
      })
      ingested = true
    } catch {
      /* fall back to direct write below */
    }
  }

  // Always keep the canonical AS-IS path readable (SDD createDesign reads it
  // directly as a fallback), whether or not ingest succeeded.
  try {
    await fs.mkdir(path.dirname(asIsPath), { recursive: true })
    await fs.writeFile(asIsPath, as_is_markdown, 'utf-8')
  } catch {
    /* vault may not exist yet */
  }
  void ingested

  return result
}

/**
 * Map detected language ids (from `detect-language`) to static-analysis
 * language plugin ids. The TS plugin covers `.js/.jsx`; the Java plugin
 * covers `.kt/.kts`. Languages without a registered plugin are dropped so
 * the analysis layer doesn't waste cycles on unsupported extensions.
 */
function mapToPluginLanguageIds(ids: string[]): string[] {
  const mapped = new Set<string>()
  for (const id of ids) {
    switch (id) {
      case 'typescript':
      case 'javascript':
        mapped.add('typescript')
        break
      case 'python':
        mapped.add('python')
        break
      case 'java':
      case 'kotlin':
        mapped.add('java')
        break
      case 'go':
        mapped.add('go')
        break
      case 'rust':
        mapped.add('rust')
        break
      default:
        // Unsupported language — skip rather than fall back to all plugins.
        break
    }
  }
  return Array.from(mapped)
}
