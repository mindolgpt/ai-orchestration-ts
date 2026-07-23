import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { ingestRaw, ingestSource } from '@/knowledge/wiki-ops'
import { analyzeProject } from '@/static-analysis'

export interface SotGenerationOptions {
  projectRoots: string[]
  updateIndex?: boolean
}

export async function generateAndStoreSot(
  vault: ObsidianVault,
  search: SemanticSearch,
  opts: SotGenerationOptions
): Promise<{ ok: boolean; pages: string[]; errors: string[]; raw_id?: string }> {
  const errors: string[] = []
  const pages: string[] = []

  try {
    const analysis = await analyzeProject(opts.projectRoots)
    const sotPages = buildSotPages(analysis)

    // Keep an immutable raw record of the analysis so the 3-layer vault
    // invariant holds (wiki pages reference raw/). Without this, lint_wiki
    // flags "wiki pages exist but raw/ has no sources".
    let rawId: string | undefined
    try {
      const rawBody = [
        '# Static Analysis Snapshot (SOT source)',
        '',
        `Generated: ${new Date().toISOString()}`,
        `Roots: ${opts.projectRoots.join(', ')}`,
        '',
        '## Raw SOT pages',
        '',
        ...sotPages.map((p) => `### ${p.title}\n\n${p.content}`),
      ].join('\n')
      const raw = await ingestRaw(vault, {
        title: `SOT static analysis ${new Date().toISOString().slice(0, 10)}`,
        content: rawBody,
        source_uri: `static-analysis://${opts.projectRoots.join(',')}`,
      })
      rawId = raw.id
    } catch (err) {
      errors.push(`Failed to store raw SOT source: ${err instanceof Error ? err.message : err}`)
    }

    for (const page of sotPages) {
      try {
        const result = await ingestSource(vault, search, {
          title: page.title,
          content: page.content,
          tags: ['sot', 'auto-generated', ...page.tags],
          subdir: 'sot',
          summary: page.summary,
          raw_id: rawId,
        })
        pages.push(
          (result as { wiki_page?: string; path?: string }).wiki_page ||
            (result as { wiki_page?: string; path?: string }).path ||
            page.title
        )
      } catch (err) {
        errors.push(
          `Failed to store ${page.title}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    if (opts.updateIndex !== false) {
      try {
        await updateSotIndex(vault, search, sotPages)
      } catch (err) {
        errors.push(`Failed to update index: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { ok: errors.length === 0, pages, errors, raw_id: rawId }
  } catch (err) {
    return {
      ok: false,
      pages: [],
      errors: [`Analysis failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

interface SotPage {
  title: string
  content: string
  tags: string[]
  summary: string
}

function buildSotPages(analysis: {
  summary: {
    totalFiles: number
    totalNodes: number
    totalEdges: number
    totalRoutes: number
    totalModels: number
  }
  routes: { method: string; path: string }[]
  models: { name: string; orm: string; tableName?: string; fields: unknown[] }[]
}): SotPage[] {
  return [
    {
      title: 'SOT: Architecture Overview',
      content: [
        `# Architecture Overview`,
        ``,
        `> Auto-generated from static analysis. Last updated: ${new Date().toISOString()}`,
        ``,
        `## Summary`,
        ``,
        `- **Source files analyzed**: ${analysis.summary.totalFiles}`,
        `- **Code graph nodes**: ${analysis.summary.totalNodes}`,
        `- **Code graph edges**: ${analysis.summary.totalEdges}`,
        `- **API routes detected**: ${analysis.summary.totalRoutes}`,
        `- **Data models detected**: ${analysis.summary.totalModels}`,
        ``,
        `## API Endpoints`,
        ``,
        ...analysis.routes.map((r) => `- \`${r.method} ${r.path}\``),
        ``,
        `## Data Models`,
        ``,
        ...analysis.models.map(
          (m) =>
            `- **${m.name}** (${m.orm}, table: \`${m.tableName || 'unknown'}\`, ${m.fields.length} fields)`
        ),
        ``,
        `## Usage`,
        ``,
        `This SOT is auto-generated. Run \`generate_sot\` to refresh.`,
        `Run \`query_code_graph\` for detailed code-level queries.`,
      ].join('\n'),
      tags: ['architecture', 'overview'],
      summary: `System architecture with ${analysis.summary.totalRoutes} routes and ${analysis.summary.totalModels} models`,
    },
    {
      title: 'SOT: API Reference',
      content: [
        `# API Reference`,
        ``,
        `> Auto-generated from static analysis.`,
        ``,
        `## Endpoints`,
        ``,
        ...analysis.routes.map((r) => `### \`${r.method} ${r.path}\``),
        ``,
        `Total: ${analysis.routes.length} endpoints`,
      ].join('\n'),
      tags: ['api', 'reference'],
      summary: `${analysis.routes.length} API endpoints`,
    },
    {
      title: 'SOT: Data Layer',
      content: [
        `# Data Layer`,
        ``,
        `> Auto-generated from static analysis.`,
        ``,
        ...analysis.models.map((m) =>
          [
            `## ${m.name}`,
            ``,
            `- **ORM**: ${m.orm}`,
            `- **Table**: \`${m.tableName || 'unknown'}\``,
            `- **Fields**: ${m.fields.length}`,
          ].join('\n')
        ),
      ].join('\n\n'),
      tags: ['data', 'models'],
      summary: `${analysis.models.length} data models across ${new Set(analysis.models.map((m) => m.orm)).size} ORM types`,
    },
  ]
}

async function updateSotIndex(
  vault: ObsidianVault,
  search: SemanticSearch,
  pages: SotPage[]
): Promise<void> {
  // Do not overwrite wiki/index.md — ingestSource already upserts catalog entries.
  // Keep a dedicated SOT catalog for agents (low-token browse).
  const indexContent = [
    '# Auto-generated SOT',
    '',
    '> Source of Truth pages from static analysis. Refresh with `generate_sot`.',
    '',
    ...pages.map((p) => {
      const slug = p.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      return `- [[${p.title}]] (\`wiki/sot/${slug}\`) — ${p.summary}`
    }),
    '',
    '## Next',
    '',
    '- `query_wiki` with snippets for these pages',
    '- `domain_context({ task, format: "path" })` before implementation',
    '',
  ].join('\n')

  await vault.writeNote('wiki/sot/index.md', indexContent, ['sot', 'index', 'auto-generated'])
  await search.addDocument(
    'wiki/sot/index.md',
    'SOT Index',
    pages.map((p) => `${p.title}: ${p.summary}`).join('\n'),
    ['sot', 'index']
  )
  await search.save()
}
