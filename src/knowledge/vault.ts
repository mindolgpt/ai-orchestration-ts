import * as fs from 'fs/promises'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import { KnowledgeDoc } from '@/knowledge/types'
import { toPosixPath } from '@/knowledge/paths'
import { DEFAULT_WIKI_SCHEMA, WIKI_SCHEMA_PATH } from '@/knowledge/wiki-schema'

const WIKI_INDEX = 'wiki/index.md'
const WIKI_LOG = 'wiki/log.md'

export class ObsidianVault {
  private root: string

  constructor(vaultPath: string) {
    this.root = path.resolve(vaultPath)
  }

  get rootPath(): string {
    return this.root
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    await fs.mkdir(path.join(this.root, 'raw'), { recursive: true })
    await fs.mkdir(path.join(this.root, 'wiki'), { recursive: true })
    await this.ensureMoc()
    await this.ensureSchema()
    await this.ensureWikiIndex()
    await this.ensureWikiLog()
  }

  isRawPath(relative: string): boolean {
    const p = toPosixPath(relative).replace(/^\.\//, '')
    return p === 'raw' || p.startsWith('raw/')
  }

  isSchemaPath(relative: string): boolean {
    return toPosixPath(relative).replace(/\.md$/, '') === WIKI_SCHEMA_PATH.replace(/\.md$/, '')
  }

  /** Paths that must not be overwritten via store_knowledge / writeNote (use dedicated APIs). */
  isProtectedPath(relative: string): boolean {
    const p = toPosixPath(relative).replace(/\.md$/, '')
    if (this.isSchemaPath(p)) return true
    return p === 'wiki/index' || p === 'wiki/log'
  }

  resolvePath(relative: string): string {
    const clean = toPosixPath(relative).replace(/\.md$/, '')
    if (path.isAbsolute(clean) || clean.startsWith('~')) {
      throw new Error(`Invalid vault path (absolute not allowed): ${relative}`)
    }
    const parts = clean.split('/').filter((p) => p && p !== '.')
    if (parts.some((p) => p === '..')) {
      throw new Error(`Invalid vault path (escapes root): ${relative}`)
    }
    const fullNoExt = path.resolve(this.root, ...parts)
    const rootResolved = path.resolve(this.root)
    const rel = path.relative(rootResolved, fullNoExt)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path escapes vault root: ${relative}`)
    }
    return `${fullNoExt}.md`
  }

  private async ensureMoc(): Promise<void> {
    const mocPath = path.join(this.root, 'index.md')
    try {
      await fs.access(mocPath)
    } catch {
      await fs.writeFile(
        mocPath,
        '# Map of Contents\n\n> Auto-generated\n\n## Knowledge Areas\n\n- [Wiki](wiki/index.md)\n- [Raw sources](raw/)\n- [Schema](AGENTS.md)\n',
        'utf-8'
      )
    }
  }

  private async ensureSchema(): Promise<void> {
    const full = path.join(this.root, WIKI_SCHEMA_PATH)
    try {
      await fs.access(full)
    } catch {
      await fs.writeFile(full, DEFAULT_WIKI_SCHEMA, 'utf-8')
    }
  }

  private async ensureWikiIndex(): Promise<void> {
    const full = this.resolvePath(WIKI_INDEX)
    try {
      await fs.access(full)
    } catch {
      await fs.writeFile(
        full,
        '---\ntags: [wiki-index]\ncreated: ' +
          new Date().toISOString() +
          '\n---\n\n# Wiki Index\n\nContent-oriented catalog. One line per page.\n\n## Pages\n\n',
        'utf-8'
      )
    }
  }

  private async ensureWikiLog(): Promise<void> {
    const full = this.resolvePath(WIKI_LOG)
    try {
      await fs.access(full)
    } catch {
      await fs.writeFile(
        full,
        '---\ntags: [wiki-log]\ncreated: ' +
          new Date().toISOString() +
          '\n---\n\n# Change Log\n\nAppend-only timeline. Do not rewrite history.\n',
        'utf-8'
      )
    }
  }

  async readSchema(): Promise<string> {
    await this.ensureSchema()
    return await fs.readFile(path.join(this.root, WIKI_SCHEMA_PATH), 'utf-8')
  }

  async schemaExists(): Promise<boolean> {
    try {
      await fs.access(path.join(this.root, WIKI_SCHEMA_PATH))
      return true
    } catch {
      return false
    }
  }

  /**
   * Write/update a note. Refuses raw/ (immutable).
   * Preserves existing frontmatter `created` on update.
   */
  async writeNote(
    relativePath: string,
    content: string,
    tags?: string[],
    links?: string[]
  ): Promise<string> {
    const posixRel = toPosixPath(relativePath).replace(/\.md$/, '')
    if (this.isRawPath(posixRel)) {
      throw new Error('raw/ is immutable — use writeRawOnce to add sources')
    }
    if (this.isProtectedPath(posixRel)) {
      throw new Error(
        `protected path cannot be written via writeNote/store_knowledge: ${relativePath} (use wiki MR / ingest tools)`
      )
    }

    const fullPath = this.resolvePath(posixRel)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })

    const existing = await this.readNote(posixRel)
    const prevCreated = existing?.match(/^---\n[\s\S]*?created:\s*(.+)\n[\s\S]*?---/)?.[1]?.trim()
    const created = prevCreated || new Date().toISOString()

    const header: string[] = ['---']
    if (tags?.length) {
      header.push(`tags: [${tags.join(',')}]`)
    }
    header.push(`created: ${created}`)
    if (prevCreated) {
      header.push(`updated: ${new Date().toISOString()}`)
    }
    header.push('---\n')

    let body = this.stripAllFrontmatter(content).trimStart()
    if (links?.length) {
      const relatedBlock = '## Related Notes\n\n' + links.map((l) => `- [[${l}]]`).join('\n')
      if (!body.includes('## Related Notes')) {
        body += '\n\n' + relatedBlock
      }
    }

    await fs.writeFile(fullPath, header.join('\n') + '\n' + body + '\n', 'utf-8')
    if (!posixRel.startsWith('wiki/')) {
      await this.updateMoc(path.posix.basename(posixRel), posixRel)
    }
    return fullPath
  }

  /** Create an immutable raw source once. Fails if file already exists. */
  async writeRawOnce(opts: {
    title: string
    content: string
    sourceUri?: string
    id?: string
  }): Promise<{ path: string; id: string; checksum: string }> {
    await fs.mkdir(path.join(this.root, 'raw'), { recursive: true })
    const id = opts.id || randomUUID().slice(0, 8)
    const slug =
      opts.title
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, '-')
        .replace(/^-|-$/g, '') || 'source'
    const rel = `raw/${id}--${slug}`
    const fullPath = this.resolvePath(rel)

    try {
      await fs.access(fullPath)
      throw new Error(`raw source already exists: ${rel}.md (immutable)`)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e instanceof Error && e.message.includes('already exists')) throw e
      if (e.code !== 'ENOENT') throw err
    }

    const checksum = createHash('sha256').update(opts.content).digest('hex').slice(0, 16)
    const body =
      `---\n` +
      `id: ${id}\n` +
      `title: ${JSON.stringify(opts.title)}\n` +
      `source_uri: ${JSON.stringify(opts.sourceUri || 'direct')}\n` +
      `checksum: ${checksum}\n` +
      `ingested_at: ${new Date().toISOString()}\n` +
      `immutable: true\n` +
      `---\n\n` +
      opts.content.trim() +
      '\n'

    await fs.writeFile(fullPath, body, 'utf-8')
    return { path: `${rel}.md`, id, checksum }
  }

  async appendLog(entry: string): Promise<void> {
    await this.ensureWikiLog()
    const full = this.resolvePath(WIKI_LOG)
    let current = await fs.readFile(full, 'utf-8')
    // Collapse accidental duplicated frontmatter from older bugs
    current = this.normalizeSingleFrontmatter(current, ['wiki-log'])
    if (!current.includes('# Change Log')) {
      current = this.ensureBodyHasHeading(current, '# Change Log\n\nAppend-only timeline.\n')
    }
    const line = entry.trim()
    if (current.includes(line)) return
    const next = current.trimEnd() + '\n\n' + line + '\n'
    await fs.writeFile(full, next, 'utf-8')
  }

  async upsertWikiIndexEntry(opts: {
    slug: string
    title: string
    summary: string
    tags?: string[]
  }): Promise<void> {
    await this.ensureWikiIndex()
    const full = this.resolvePath(WIKI_INDEX)
    let current = await fs.readFile(full, 'utf-8')
    current = this.normalizeSingleFrontmatter(current, ['wiki-index'])
    if (!current.includes('## Pages')) {
      current = current.trimEnd() + '\n\n## Pages\n\n'
    }

    const summary = opts.summary.replace(/\s+/g, ' ').trim().slice(0, 160)
    const tagSuffix = opts.tags?.length ? ` (${opts.tags.join(', ')})` : ''
    const entry = `- [[${opts.slug}]] — ${opts.title}: ${summary}${tagSuffix}`

    const lines = current.split('\n')
    const pagesIdx = lines.findIndex((l) => l.trim() === '## Pages')
    const linkRe = new RegExp(`^- \\[\\[${opts.slug}\\]\\]`)
    let replaced = false
    for (let i = pagesIdx + 1; i < lines.length; i++) {
      if (linkRe.test(lines[i])) {
        lines[i] = entry
        replaced = true
        break
      }
    }
    if (!replaced) {
      lines.splice(pagesIdx + 1, 0, entry)
    }
    await fs.writeFile(full, lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n', 'utf-8')
  }

  async readNote(relativePath: string): Promise<string | null> {
    const fullPath = this.resolvePath(relativePath)
    try {
      return await fs.readFile(fullPath, 'utf-8')
    } catch {
      return null
    }
  }

  async listNotes(prefix = ''): Promise<string[]> {
    const results: string[] = []
    const normalizedPrefix = toPosixPath(prefix)

    const scan = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '.index') continue
          await scan(full)
        } else if (entry.name.endsWith('.md')) {
          const rel = toPosixPath(path.relative(this.root, full))
          if (!normalizedPrefix || rel.startsWith(normalizedPrefix)) {
            results.push(rel)
          }
        }
      }
    }

    try {
      await scan(this.root)
    } catch {
      return []
    }
    return results.sort()
  }

  async searchByTag(tag: string): Promise<string[]> {
    const results: string[] = []
    const files = await this.listNotes()
    for (const file of files) {
      const content = await this.readNote(file)
      if (content && content.includes(`tags: [${tag}`)) {
        results.push(file)
      }
    }
    return results
  }

  async getTags(relativePath: string): Promise<string[]> {
    const content = await this.readNote(relativePath)
    if (!content) return []
    const match = content.match(/tags:\s*\[(.+?)\]/)
    return match ? match[1].split(',').map((t) => t.trim()) : []
  }

  private async updateMoc(title: string, link: string): Promise<void> {
    const mocPath = path.join(this.root, 'index.md')
    let content: string
    try {
      content = await fs.readFile(mocPath, 'utf-8')
    } catch {
      content = '# Map of Contents\n\n> Auto-generated\n\n## Knowledge Areas\n\n'
    }
    const entry = `- [${title}](${link})`
    if (!content.includes(entry)) {
      content = content.replace('## Knowledge Areas', `## Knowledge Areas\n${entry}`)
      await fs.writeFile(mocPath, content, 'utf-8')
    }
  }

  async toKnowledgeDoc(relativePath: string): Promise<KnowledgeDoc | null> {
    const content = await this.readNote(relativePath)
    if (!content) return null

    const tags = await this.getTags(relativePath)
    const links = this.extractLinks(content)
    const createdMatch = content.match(/created:\s*(.+)/)

    return {
      path: toPosixPath(relativePath),
      title: path.posix.basename(toPosixPath(relativePath).replace(/\.md$/, '')),
      content: this.stripAllFrontmatter(content),
      tags,
      links,
      createdAt: createdMatch?.[1] || new Date().toISOString(),
    }
  }

  private extractLinks(content: string): string[] {
    const matches = content.matchAll(/\[\[([^\]]+)\]\]/g)
    return Array.from(matches, (m) => m[1])
  }

  stripAllFrontmatter(content: string): string {
    let out = content
    while (/^---\n[\s\S]*?\n---\n?/.test(out)) {
      out = out.replace(/^---\n[\s\S]*?\n---\n?/, '')
    }
    return out
  }

  private normalizeSingleFrontmatter(content: string, tags: string[]): string {
    const body = this.stripAllFrontmatter(content).trimStart()
    const createdMatch = content.match(/created:\s*(.+)/)
    const created = createdMatch?.[1]?.trim() || new Date().toISOString()
    return `---\ntags: [${tags.join(',')}]\ncreated: ${created}\n---\n\n` + body
  }

  private ensureBodyHasHeading(content: string, headingBlock: string): string {
    const fm = content.match(/^---\n[\s\S]*?\n---\n?/)
    if (fm) {
      return fm[0] + '\n' + headingBlock + this.stripAllFrontmatter(content)
    }
    return headingBlock + content
  }
}
