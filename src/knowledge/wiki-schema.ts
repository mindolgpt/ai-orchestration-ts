/**
 * Vault-level wiki schema — makes the LLM a disciplined wiki maintainer.
 * Seeded at vault/AGENTS.md on initialize.
 */
export const WIKI_SCHEMA_PATH = 'AGENTS.md'

export const DEFAULT_WIKI_SCHEMA = `# Wiki Schema (AGENTS.md)

This file is the **schema** for this vault. Read it before ingest / query / lint.
Without this schema you are a generic chatbot. With it you are a **disciplined wiki maintainer**.

## 3 Layers (never collapse them)

1. **raw/** — Immutable original sources. Read only. Never edit or delete via tools.
2. **wiki/** — LLM-generated markdown (summaries, entities, concepts, comparisons, synthesis).
3. **AGENTS.md (this file)** — Operating rules. Change only via human/MR review.

## Files with special roles

| File | Role |
|------|------|
| \`wiki/index.md\` | Content catalog — one-line summary per page |
| \`wiki/log.md\` | Append-only timeline of what happened when |
| \`raw/*\` | Source of truth documents (immutable) |

Never merge index and log. Never put narrative history into index.

## Ingest workflow

1. Call \`get_wiki_schema\` (or re-read this file) if unsure of rules.
2. Persist the original with \`ingest_raw\` (immutable). Do not skip raw for durable knowledge.
3. Discuss key takeaways with the user when needed.
4. Call \`ingest_source\` **once per concept** (one page = one concept). Or \`ingest_pipeline\` / \`ingest_source_batch\` for batch flows.
5. Update related entity/concept pages with \`update_wiki_page\` (cross-links, superseded claims).
6. Verify \`wiki/index.md\` has a one-line summary and \`wiki/log.md\` gained an append entry.

## Wiki taxonomy (recommended subdirs under wiki/)

| Subdir | Use for |
|--------|---------|
| \`domain/\` | Bounded context business rules |
| \`architecture/\` | ADR, saga, design principles |
| \`engineering/\` | Coding standards, testing, security |
| \`stacks/\` | Framework playbooks (\`seed_stack_playbooks\`) |

## Query workflow

1. Call \`query_wiki\` — search, read returned pages, answer **with citations** (page titles/paths).
2. If the answer is durable and reusable, call \`file_back\` to write it into the wiki.
3. Do not invent facts that are not in wiki/raw; say what is missing instead.

## Lint workflow

1. Run \`lint_wiki\` (structural: orphans, index coverage, schema/raw presence).
2. Then manually check: contradictions between pages, stale claims vs newer raw sources.
3. Fix issues via \`update_wiki_page\` / new ingest — never by editing raw/.

## Hard rules

- Never modify or delete files under \`raw/\`.
- Never invent source citations.
- Prefer updating an existing concept page over creating duplicates.
- Team changes to this schema require review (treat as MR-owned policy).
`

export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  )
}

/** Sanitize taxonomy subdir under wiki/ (rejects `..` segments and special chars). */
export function sanitizeWikiSubdir(subdir?: string): string | undefined {
  if (!subdir?.trim()) return undefined
  const parts = subdir
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..' && !/[,{}[\]()]/g.test(p))
  return parts.length ? parts.join('/') : undefined
}

/** Resolve [[wikilink]] against known wiki pages (subdir-aware). */
export function resolveWikiLinkPath(rawLink: string, pageSet: Set<string>): string | null {
  const link = rawLink
    .split('|')[0]
    .trim()
    .replace(/\.md$/i, '')
    .replace(/^wiki\//, '')
  if (!link || link.includes('..')) return null

  const candidates: string[] = []
  if (link.includes('/')) {
    const slugParts = link
      .split('/')
      .filter(Boolean)
      .map((seg) => slugifyTitle(seg))
    candidates.push(`wiki/${slugParts.join('/')}.md`)
    candidates.push(`wiki/${link}.md`)
  } else {
    const slug = slugifyTitle(link)
    candidates.push(`wiki/${slug}.md`)
    for (const p of pageSet) {
      const base = p.replace(/^wiki\//, '').replace(/\.md$/, '')
      const leaf = base.includes('/') ? base.slice(base.lastIndexOf('/') + 1) : base
      if (leaf === slug || slugifyTitle(leaf) === slug || leaf === link) {
        candidates.push(p)
      }
    }
  }

  for (const c of candidates) {
    if (pageSet.has(c)) return c
  }
  return null
}
