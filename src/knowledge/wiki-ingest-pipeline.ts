import * as fs from 'fs/promises'
import * as path from 'path'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { ingestRaw, ingestSource, lintWiki, IngestSourceInput } from '@/knowledge/wiki-ops'

export interface IngestConceptInput {
  title: string
  content?: string
  outline?: string
  tags?: string[]
  subdir?: string
  summary?: string
}

export interface IngestRawOptions {
  title: string
  content?: string
  file_path?: string
  source_uri?: string
  id?: string
  project_root?: string
}

export interface IngestSourceBatchInput {
  concepts: IngestConceptInput[]
  raw_id?: string
  source_path?: string
  default_subdir?: string
}

export interface IngestPipelineInput {
  title?: string
  content?: string
  file_path?: string
  source_uri?: string
  concepts?: IngestConceptInput[]
  run_lint?: boolean
  lint_deep?: boolean
  project_root?: string
}

const TEXT_EXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html', '.htm'])

function assertPathInsideRoots(absPath: string, roots: string[]): void {
  const resolved = path.resolve(absPath)
  const ok = roots.some((r) => {
    const root = path.resolve(r)
    const rel = path.relative(root, resolved)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
  if (!ok) {
    throw new Error(
      `file_path must be under project or vault root (got ${resolved}). Allowed: ${roots.join(', ')}`
    )
  }
}

export async function readIngestFileContent(
  filePath: string,
  projectRoot?: string,
  allowedRoots?: string[]
): Promise<{ content: string; source_uri: string; title_hint: string }> {
  const root = path.resolve(projectRoot || process.cwd())
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath)
  const roots = (allowedRoots?.length ? allowedRoots : [root]).map((r) => path.resolve(r))
  assertPathInsideRoots(abs, roots)

  const ext = path.extname(abs).toLowerCase()

  if (!TEXT_EXT.has(ext)) {
    throw new Error(
      `Unsupported file type ${ext}. Supported: ${[...TEXT_EXT].join(', ')}. Convert PDF/binary to text first.`
    )
  }

  const content = await fs.readFile(abs, 'utf-8')
  const base = path.basename(abs, ext)
  return { content, source_uri: abs, title_hint: base.replace(/[-_]+/g, ' ').trim() }
}

export async function ingestRawFromOpts(vault: ObsidianVault, opts: IngestRawOptions) {
  let content = opts.content || ''
  let sourceUri = opts.source_uri

  if (opts.file_path) {
    const file = await readIngestFileContent(opts.file_path, opts.project_root, [
      opts.project_root || process.cwd(),
      vault.rootPath,
    ])
    content = file.content
    sourceUri = sourceUri || file.source_uri
    if (!opts.title || opts.title === 'Untitled') {
      opts = { ...opts, title: file.title_hint || opts.title }
    }
  }

  if (!content.trim()) {
    throw new Error('ingest_raw requires content or file_path with readable text')
  }

  return ingestRaw(vault, {
    title: opts.title,
    content,
    source_uri: sourceUri,
    id: opts.id,
  })
}

function conceptToSourceInput(
  c: IngestConceptInput,
  raw_id?: string,
  source_path?: string,
  default_subdir?: string
): IngestSourceInput {
  const body =
    c.content?.trim() ||
    (c.outline
      ? `# ${c.title}\n\n${c.outline.trim()}\n\n> Expand from raw source and link related [[pages]].`
      : `# ${c.title}\n\n> Generated from ingest pipeline. Add detail from raw source.`)

  return {
    title: c.title,
    content: body,
    tags: c.tags,
    raw_id,
    source_path,
    subdir: c.subdir || default_subdir,
    summary: c.summary,
  }
}

export async function ingestSourceBatch(
  vault: ObsidianVault,
  search: SemanticSearch,
  opts: IngestSourceBatchInput
) {
  if (!opts.concepts?.length) {
    throw new Error('ingest_source_batch requires at least one concept in concepts[]')
  }

  const pages = []
  for (const c of opts.concepts) {
    pages.push(
      await ingestSource(
        vault,
        search,
        conceptToSourceInput(c, opts.raw_id, opts.source_path, opts.default_subdir)
      )
    )
  }

  return {
    ok: true,
    count: pages.length,
    pages,
    raw_id: opts.raw_id || null,
  }
}

export async function ingestPipeline(
  vault: ObsidianVault,
  search: SemanticSearch,
  opts: IngestPipelineInput
) {
  const title = opts.title || (opts.file_path ? undefined : 'Untitled source')
  const raw = await ingestRawFromOpts(vault, {
    title: title || 'Untitled source',
    content: opts.content,
    file_path: opts.file_path,
    source_uri: opts.source_uri,
    project_root: opts.project_root,
  })

  const resolvedTitle =
    title ||
    raw.path
      .replace(/^raw\/|\.md$/g, '')
      .split('--')
      .slice(1)
      .join('-') ||
    'Source'

  let wiki_pages
  if (opts.concepts?.length) {
    const batch = await ingestSourceBatch(vault, search, {
      concepts: opts.concepts,
      raw_id: raw.id,
      source_path: raw.path,
    })
    wiki_pages = batch.pages
  } else {
    const excerpt = (opts.content || '').slice(0, 4000) || 'See raw source for full text.'
    const single = await ingestSource(vault, search, {
      title: resolvedTitle,
      content: `# ${resolvedTitle}\n\n${excerpt}\n\n> Source: raw_id=${raw.id}`,
      raw_id: raw.id,
      tags: ['pipeline'],
      summary: `Ingested from ${raw.path}`,
    })
    wiki_pages = [single]
  }

  let lint
  if (opts.run_lint !== false) {
    lint = await lintWiki(vault, { deep: opts.lint_deep === true, staleDays: 90 })
  }

  return {
    ok: true,
    raw,
    wiki_pages,
    lint,
    next_steps: [
      'Review wiki pages and split concepts if the single-page default is too broad',
      'update_wiki_page for cross-links to existing domain pages',
      opts.run_lint === false ? 'Run lint_wiki when done' : 'Fix lint issues if any',
    ],
  }
}
