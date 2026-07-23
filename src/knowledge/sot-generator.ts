import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { ingestSource, updateWikiPage } from '@/knowledge/wiki-ops'
import { analyzeProject } from '@/static-analysis'

export interface SotGenerationOptions {
  projectRoots: string[]
  updateIndex?: boolean
}

export async function generateAndStoreSot(
  vault: ObsidianVault,
  search: SemanticSearch,
  opts: SotGenerationOptions
): Promise<{ ok: boolean; pages: string[]; errors: string[] }> {
  const errors: string[] = []
  const pages: string[] = []

  try {
    const analysis = await analyzeProject(opts.projectRoots)
    const sotPages = buildSotPages(analysis)

    for (const page of sotPages) {
      try {
        const result = await ingestSource(vault, search, {
          title: page.title,
          content: page.content,
          tags: ['sot', 'auto-generated', ...page.tags],
          subdir: 'sot',
          summary: page.summary,
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

    return { ok: errors.length === 0, pages, errors }
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
  const indexContent = [
    '## Auto-generated SOT',
    '',
    '> Source of Truth pages generated from static analysis.',
    '',
    ...pages.map((p) => `- [[sot/${p.title}]] — ${p.summary}`),
    '',
  ].join('\n')

  try {
    await updateWikiPage(vault, search, {
      title: 'wiki/index',
      content: indexContent,
      tags: ['sot', 'index'],
    })
  } catch {
    await vault.writeNote('wiki/sot-index.md', indexContent)
  }
}
