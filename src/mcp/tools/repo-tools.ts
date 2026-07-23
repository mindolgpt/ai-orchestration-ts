import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'
import { analyzeProject } from '@/static-analysis'
import * as fs from 'fs/promises'
import * as path from 'path'

interface RepoConfig {
  name: string
  path: string
  url?: string
  branch?: string
  analyze: boolean
}

interface MultiRepoConfig {
  repositories: RepoConfig[]
}

function getConfigPath(root: string): string {
  return path.join(root, '.aio', 'repos.json')
}

async function loadRepos(root: string): Promise<MultiRepoConfig> {
  try {
    const data = await fs.readFile(getConfigPath(root), 'utf-8')
    return JSON.parse(data) as MultiRepoConfig
  } catch {
    return { repositories: [] }
  }
}

async function saveRepos(root: string, config: MultiRepoConfig): Promise<void> {
  await fs.mkdir(path.dirname(getConfigPath(root)), { recursive: true })
  await fs.writeFile(getConfigPath(root), JSON.stringify(config, null, 2), 'utf-8')
}

export function registerRepoTools(server: McpServer): void {
  const root = resolveProjectRoot()

  registerMcpTool(
    server,
    'repo_register',
    {
      description: '멀티 레포 등록. 로컬 경로 또는 git URL로 다른 저장소를 분석 대상에 추가.',
      inputSchema: z.object({
        name: z.string(),
        path: z.string().optional(),
        url: z.string().optional(),
        branch: z.string().optional(),
        analyze: z.boolean().optional(),
      }),
    },
    async (args) => {
      const config = await loadRepos(root)
      const repo: RepoConfig = {
        name: args.name,
        path: args.path || args.url || args.name,
        url: args.url,
        branch: args.branch || 'main',
        analyze: args.analyze ?? true,
      }
      const existing = config.repositories.findIndex((r) => r.name === args.name)
      if (existing >= 0) {
        config.repositories[existing] = repo
      } else {
        config.repositories.push(repo)
      }
      await saveRepos(root, config)
      return jsonResult({ ok: true, repository: repo, total_repos: config.repositories.length })
    }
  )

  registerMcpTool(
    server,
    'repo_list',
    {
      description: '등록된 멀티 레포 목록 조회.',
      inputSchema: z.object({}),
    },
    async () => {
      const config = await loadRepos(root)
      return jsonResult({
        repositories: config.repositories.map((r) => ({
          name: r.name,
          path: r.path,
          branch: r.branch,
          analyze: r.analyze,
        })),
        total: config.repositories.length,
      })
    }
  )

  registerMcpTool(
    server,
    'cross_repo_query',
    {
      description: '등록된 모든 레포에서 심볼/의존성 검색.',
      inputSchema: z.object({
        query: z.string(),
        repos: z.array(z.string()).optional(),
        mode: z.enum(['symbol', 'dependency', 'impact']).optional(),
      }),
    },
    async (args) => {
      const config = await loadRepos(root)
      const targetRepos = args.repos?.length
        ? config.repositories.filter((r) => args.repos!.includes(r.name))
        : config.repositories

      const results: Array<{ repo: string; file: string; symbol: string; kind: string }> = []

      for (const repo of targetRepos) {
        if (!repo.analyze) continue
        try {
          const analysis = await analyzeProject([repo.path], {
            include: [`**/*${args.query}*`],
          })
          const matched = Array.from(analysis.graph.nodes.values()).filter((n) =>
            n.name.toLowerCase().includes(args.query.toLowerCase())
          )

          for (const node of matched) {
            results.push({
              repo: repo.name,
              file: node.filePath,
              symbol: node.name,
              kind: node.kind,
            })
          }
        } catch {
          /* skip unanalyzable repos */
        }
      }

      return jsonResult({
        query: args.query,
        mode: args.mode || 'symbol',
        results: results.slice(0, 100),
        total: results.length,
        repos_searched: targetRepos.map((r) => r.name),
      })
    }
  )

  registerMcpTool(
    server,
    'repo_remove',
    {
      description: '등록된 멀티 레포 제거.',
      inputSchema: z.object({
        name: z.string(),
      }),
    },
    async (args) => {
      const config = await loadRepos(root)
      const before = config.repositories.length
      config.repositories = config.repositories.filter((r) => r.name !== args.name)
      if (config.repositories.length === before) {
        return jsonResult({ error: `Repository '${args.name}' not found` })
      }
      await saveRepos(root, config)
      return jsonResult({ ok: true, removed: args.name })
    }
  )
}
