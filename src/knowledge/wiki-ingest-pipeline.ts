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
  /** When set, used to expand outline-only concepts from raw body */
  raw_text?: string
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
  /** Re-ingest wiki from an existing immutable raw document (no new raw file) */
  raw_id?: string
  /** Alias for providing raw_id — skip writing a new raw */
  skip_raw?: boolean
}

/** Minimum length for chat/free-text to count as a real document body */
export const MIN_INGEST_CONTENT_CHARS = 80

const TEXT_EXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html', '.htm'])

import { resolveRealPathInsideRoots } from '@/security/path-containment'

export function stripYamlFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end === -1) return text
  return text.slice(end + 4).replace(/^\s*\n/, '')
}

export function hasSubstantialIngestContent(content?: string | null): boolean {
  return Boolean(content && content.trim().length >= MIN_INGEST_CONTENT_CHARS)
}

/** True when NL/execute path has enough to create or re-use a document safely */
export function hasIngestDocumentPayload(opts: {
  content?: string | null
  file_path?: string | null
  raw_id?: string | null
  skip_raw?: boolean | null
}): boolean {
  if (opts.raw_id?.trim()) return true
  if (opts.skip_raw && opts.raw_id?.trim()) return true
  if (opts.file_path?.trim()) return true
  return hasSubstantialIngestContent(opts.content)
}

export function extractSectionFromRaw(
  rawText: string,
  title: string,
  outline?: string
): string | null {
  const body = stripYamlFrontmatter(rawText).trim()
  if (!body) return null

  const lines = body.split(/\r?\n/)
  const titleNorm = title.trim().toLowerCase()
  const titleTokens = titleNorm.split(/[^a-z0-9가-힣]+/).filter((t) => t.length >= 2)

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,4})\s+(.+)$/)
    if (!m) continue
    const heading = m[2].trim().toLowerCase()
    if (
      heading === titleNorm ||
      heading.includes(titleNorm) ||
      titleNorm.includes(heading) ||
      (titleTokens.length > 0 && titleTokens.every((t) => heading.includes(t)))
    ) {
      start = i
      break
    }
  }

  if (start === -1 && outline?.trim()) {
    const outlineTokens = outline
      .toLowerCase()
      .split(/[^a-z0-9가-힣]+/)
      .filter((t) => t.length >= 4)
      .slice(0, 4)
    if (outlineTokens.length) {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,4})\s+(.+)$/)
        if (!m) continue
        const heading = m[2].trim().toLowerCase()
        if (outlineTokens.some((t) => heading.includes(t))) {
          start = i
          break
        }
      }
    }
  }

  if (start === -1) return null

  const startLevel = (lines[start].match(/^(#{1,4})/) || ['#'])[0].length
  const chunk: string[] = [lines[start]]
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,4})\s+/)
    if (m && m[1].length <= startLevel) break
    chunk.push(lines[i])
  }

  const section = chunk.join('\n').trim()
  return section.length >= 20 ? section : null
}

export function buildConceptBody(
  c: IngestConceptInput,
  rawText?: string
): string {
  if (c.content?.trim()) return c.content.trim()

  if (rawText?.trim()) {
    const extracted = extractSectionFromRaw(rawText, c.title, c.outline)
    if (extracted) {
      const bits = [extracted]
      if (c.summary?.trim()) {
        bits.push('', `> Summary: ${c.summary.trim()}`)
      }
      return bits.join('\n')
    }
  }

  const parts = [`# ${c.title}`, '']
  if (c.summary?.trim()) {
    parts.push(c.summary.trim(), '')
  }
  if (c.outline?.trim()) {
    parts.push(c.outline.trim(), '')
  }
  if (!c.summary?.trim() && !c.outline?.trim()) {
    parts.push('> Generated from ingest pipeline. Add detail from raw source.', '')
  } else if (rawText?.trim()) {
    parts.push(
      '> Section heading not found in raw — outline/summary used. Expand with update_wiki_page if needed.',
      ''
    )
  } else {
    parts.push('> Expand from raw source and link related [[pages]].', '')
  }
  return parts.join('\n').trim() + '\n'
}

export async function loadRawDocument(
  vault: ObsidianVault,
  rawId: string
): Promise<{ id: string; path: string; title: string; body: string; full: string; checksum?: string }> {
  const id = rawId.trim()
  if (!id) throw new Error('raw_id is required')

  const notes = await vault.listNotes('raw/')
  const match =
    notes.find((n) => n === `raw/${id}.md`) ||
    notes.find((n) => n.startsWith(`raw/${id}--`)) ||
    notes.find((n) => n.includes(`/${id}--`))

  if (!match) {
    throw new Error(`raw source not found for raw_id=${id}`)
  }

  const full = await vault.readNote(match)
  if (!full) throw new Error(`failed to read raw source ${match}`)

  const titleMatch = full.match(/^title:\s*(.+)$/m)
  let title = id
  if (titleMatch) {
    try {
      title = JSON.parse(titleMatch[1]) as string
    } catch {
      title = titleMatch[1].replace(/^"|"$/g, '').trim()
    }
  } else {
    const fromPath = match.replace(/^raw\//, '').replace(/\.md$/, '').split('--').slice(1).join('--')
    if (fromPath) title = fromPath.replace(/-/g, ' ')
  }

  const checksum = full.match(/^checksum:\s*(\S+)/m)?.[1]
  return {
    id,
    path: match.endsWith('.md') ? match : `${match}.md`,
    title,
    body: stripYamlFrontmatter(full),
    full,
    checksum,
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
  await resolveRealPathInsideRoots(abs, roots)

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
  default_subdir?: string,
  rawText?: string
): IngestSourceInput {
  return {
    title: c.title,
    content: buildConceptBody(c, rawText),
    tags: c.tags,
    raw_id,
    source_path,
    subdir: c.subdir || default_subdir,
    summary: c.summary || c.outline?.slice(0, 160),
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

  let rawText = opts.raw_text
  if (!rawText && opts.raw_id) {
    try {
      const doc = await loadRawDocument(vault, opts.raw_id)
      rawText = doc.body
      if (!opts.source_path) opts = { ...opts, source_path: doc.path }
    } catch {
      /* keep outline/summary fallback */
    }
  }

  const pages = []
  for (const c of opts.concepts) {
    pages.push(
      await ingestSource(
        vault,
        search,
        conceptToSourceInput(c, opts.raw_id, opts.source_path, opts.default_subdir, rawText)
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
  const existingRawId = opts.raw_id?.trim()
  if (opts.skip_raw && !existingRawId) {
    throw new Error('ingest_pipeline skip_raw requires raw_id')
  }
  const reingest = Boolean(existingRawId)

  let raw: { path: string; id: string; checksum: string }
  let rawBody: string
  let resolvedTitle: string

  if (reingest) {
    const id = existingRawId!
    const existing = await loadRawDocument(vault, id)
    raw = {
      path: existing.path,
      id: existing.id,
      checksum: existing.checksum || '',
    }
    rawBody = existing.body
    resolvedTitle = opts.title || existing.title || 'Source'
  } else {
    if (!hasIngestDocumentPayload(opts)) {
      throw new Error(
        'ingest_pipeline requires file_path, raw_id (re-ingest), or substantial content ' +
          `(>= ${MIN_INGEST_CONTENT_CHARS} chars). Refusing to ingest chat/command text.`
      )
    }

    const title = opts.title || (opts.file_path ? undefined : 'Untitled source')
    let content = opts.content || ''
    let sourceUri = opts.source_uri

    if (opts.file_path) {
      const file = await readIngestFileContent(opts.file_path, opts.project_root, [
        opts.project_root || process.cwd(),
        vault.rootPath,
      ])
      content = file.content
      sourceUri = sourceUri || file.source_uri
      if (!title || title === 'Untitled' || title === 'Untitled source') {
        opts = { ...opts, title: file.title_hint || title }
      }
    }

    rawBody = content
    const created = await ingestRaw(vault, {
      title: opts.title || title || 'Untitled source',
      content,
      source_uri: sourceUri,
    })
    raw = created
    resolvedTitle =
      opts.title ||
      title ||
      raw.path
        .replace(/^raw\/|\.md$/g, '')
        .split('--')
        .slice(1)
        .join('-') ||
      'Source'
  }

  let wiki_pages
  if (opts.concepts?.length) {
    const batch = await ingestSourceBatch(vault, search, {
      concepts: opts.concepts,
      raw_id: raw.id,
      source_path: raw.path,
      raw_text: rawBody,
    })
    wiki_pages = batch.pages
  } else {
    const excerpt = (rawBody || '').slice(0, 4000) || 'See raw source for full text.'
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
    reingest,
    next_steps: [
      'Review wiki pages and split concepts if the single-page default is too broad',
      'update_wiki_page for cross-links to existing domain pages',
      opts.run_lint === false ? 'Run lint_wiki when done' : 'Fix lint issues if any',
    ],
  }
}
