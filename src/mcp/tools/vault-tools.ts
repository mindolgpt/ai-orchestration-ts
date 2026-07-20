import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import {
  listVaultEntries,
  registerVault,
  loadVaultRegistry,
  saveVaultRegistry,
} from '@/knowledge/vault-registry'
import { scanRawInbox, ensureRawInbox, rawInboxDir } from '@/knowledge/raw-inbox'
import { collectDashboardStats } from '@/dashboard/server'
import { resolveProjectRoot } from '@/knowledge/paths'

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

export function registerVaultTools(
  server: McpServer,
  vault: ObsidianVault,
  search: SemanticSearch,
  projectRoot?: string
): void {
  const root = projectRoot || resolveProjectRoot()

  server.registerTool(
    'list_vaults',
    {
      description:
        'List registered vaults from .aio/vaults.yaml. Active vault is chosen at MCP process start via AIO_VAULT_NAME / AIO_VAULT_PATH / registry default — change env and restart MCP to switch (register_vault only updates yaml).',
    },
    async () => {
      const reg = await loadVaultRegistry(root)
      const entries = await listVaultEntries(root)
      return jsonResult({
        default: reg.default,
        active_env: process.env.AIO_VAULT_NAME || null,
        vaults: entries,
      })
    }
  )

  server.registerTool(
    'register_vault',
    {
      description:
        'Register a vault in .aio/vaults.yaml. Does not switch the running MCP vault — set AIO_VAULT_NAME and restart to activate.',
      inputSchema: z.object({
        name: z.string(),
        path: z.string(),
        domain: z.string().optional(),
        description: z.string().optional(),
        default: z.boolean().optional(),
      }),
    },
    async (args) => {
      const reg = await registerVault(args, root)
      return jsonResult({ saved: true, registry: reg })
    }
  )

  server.registerTool(
    'scan_raw_inbox',
    {
      description:
        'Process files dropped in vault/raw-inbox/ through ingest_pipeline. Moves success → raw-inbox/processed/, failure → raw-inbox/failed/.',
      inputSchema: z.object({
        subdir: z.string().optional(),
        run_lint: z.boolean().optional(),
      }),
    },
    async (args) => {
      await ensureRawInbox(vault.rootPath)
      const result = await scanRawInbox(vault, search, {
        project_root: root,
        subdir: args.subdir,
        run_lint: args.run_lint !== false,
      })
      return jsonResult({
        inbox: rawInboxDir(vault.rootPath),
        ...result,
      })
    }
  )

  server.registerTool(
    'get_dashboard_stats',
    {
      description: 'Wiki coverage, proposals, raw inbox, events — same data as `aio dashboard` UI.',
    },
    async () => jsonResult(await collectDashboardStats(vault, root))
  )
}

export { saveVaultRegistry }
