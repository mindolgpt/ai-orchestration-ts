import * as fs from 'fs/promises'
import * as path from 'path'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { getWikiSchema, queryWiki } from '@/knowledge/wiki-ops'
import { resolveProjectRoot } from '@/knowledge/paths'
import { loadDomainProfile } from '@/harness/profile'
import { DomainContextPack, LoopStep } from '@/harness/types'

const CACHE_FILE = 'harness-context.json'

function excerpt(text: string, max = 1200): string {
  const body = text.replace(/^---[\s\S]*?---\s*/, '').trim()
  return body.length > max ? body.slice(0, max) + '\n…' : body
}

function buildHarnessPrompt(
  task: string,
  loopSteps: LoopStep[],
  requireCitations: boolean
): string {
  const steps = loopSteps
    .map((s, i) => {
      switch (s) {
        case 'bootstrap_domain':
          return `${i + 1}. bootstrap_domain — load wiki context for this task`
        case 'query_wiki':
          return `${i + 1}. query_wiki — search domain knowledge; cite page titles`
        case 'plan_task':
          return `${i + 1}. plan_task — decompose into DAG-friendly subtasks`
        case 'execute_dag':
          return `${i + 1}. execute_dag — run layers; use resume on partial failure`
        case 'implement':
          return `${i + 1}. implement — code/docs aligned with wiki bounded contexts`
        case 'verify':
          return `${i + 1}. verify — tests/lint; do not self-report without running`
        case 'file_back':
          return `${i + 1}. file_back — durable decisions back to wiki`
        case 'lint_wiki':
          return `${i + 1}. lint_wiki — structural wiki health`
        default:
          return `${i + 1}. ${s}`
      }
    })
    .join('\n')

  return [
    `# Domain harness — task`,
    task,
    '',
    '## Required loop (aio-mcp)',
    steps,
    '',
    requireCitations
      ? 'Always cite wiki page titles/paths. Do not invent domain facts missing from wiki/raw.'
      : 'Prefer wiki citations when available.',
    '',
    'If implementing code: respect bounded contexts and stack conventions from the context pack.',
  ].join('\n')
}

export async function buildDomainContextPack(
  vault: ObsidianVault,
  search: SemanticSearch,
  task: string,
  opts?: { top_k?: number; extra_queries?: string[]; project_root?: string }
): Promise<DomainContextPack> {
  const { profile } = await loadDomainProfile(vault, opts?.project_root)
  const topK = opts?.top_k ?? profile.wiki?.default_top_k ?? 5
  const schema = await getWikiSchema(vault)
  const wikiIndex = (await vault.readNote('wiki/index.md')) || ''

  const queries = [
    task,
    ...(profile.wiki?.query_hints || []),
    ...(opts?.extra_queries || []),
    ...(profile.wiki?.overview_pages || []).slice(0, 3),
  ]

  const seen = new Set<string>()
  const pages: DomainContextPack['pages'] = []

  for (const q of queries) {
    if (!q?.trim()) continue
    const result = await queryWiki(vault, search, q.trim(), topK)
    for (const p of result.pages) {
      if (seen.has(p.path)) continue
      seen.add(p.path)
      pages.push({
        path: p.path,
        title: p.title,
        score: p.score,
        excerpt: excerpt(p.full_content || p.snippet),
      })
    }
    if (pages.length >= topK + 3) break
  }

  // Ensure overview pages are included even if search missed them
  for (const slug of profile.wiki?.overview_pages || []) {
    const rel = slug.startsWith('wiki/') ? slug : `wiki/${slug}`
    const full = rel.endsWith('.md') ? rel : `${rel}.md`
    if (seen.has(full)) continue
    const content = await vault.readNote(full.replace(/\.md$/, ''))
    if (content) {
      seen.add(full)
      pages.unshift({
        path: full,
        title: slug,
        excerpt: excerpt(content),
      })
    }
  }

  const loopSteps = profile.loop?.steps || [
    'bootstrap_domain',
    'plan_task',
    'implement',
    'verify',
    'file_back',
  ]

  const pack: DomainContextPack = {
    task,
    profile,
    schema_excerpt: excerpt(schema.content, 800),
    wiki_index_excerpt: excerpt(wikiIndex, 600),
    pages: pages.slice(0, topK + 5),
    citations: pages.map((p) => ({ path: p.path, title: p.title, score: p.score })),
    harness_prompt: buildHarnessPrompt(task, loopSteps, profile.loop?.require_citations !== false),
    loop_steps: loopSteps,
    cached_at: new Date().toISOString(),
  }

  return pack
}

export async function cacheContextPack(
  pack: DomainContextPack,
  projectRoot?: string
): Promise<string> {
  const root = projectRoot || resolveProjectRoot()
  const file = path.join(root, '.aio', CACHE_FILE)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(pack, null, 2), 'utf-8')
  return file
}

export function contextCachePath(projectRoot?: string): string {
  return path.join(projectRoot || resolveProjectRoot(), '.aio', CACHE_FILE)
}

export async function readCachedContextPack(
  projectRoot?: string
): Promise<DomainContextPack | null> {
  try {
    const raw = await fs.readFile(contextCachePath(projectRoot), 'utf-8')
    return JSON.parse(raw) as DomainContextPack
  } catch {
    return null
  }
}

export function contextPackToMarkdown(pack: DomainContextPack): string {
  const lines = [
    pack.harness_prompt,
    '',
    '## Wiki pages in context',
    ...pack.pages.map(
      (p) =>
        `### [[${p.title}]] (${p.path})${p.score != null ? ` — score ${p.score.toFixed(3)}` : ''}\n${p.excerpt}`
    ),
    '',
    '## Schema excerpt',
    pack.schema_excerpt,
  ]
  return lines.join('\n')
}
