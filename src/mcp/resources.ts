import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ObsidianVault } from '@/knowledge/vault'
import { ALL_STACK_IDS } from '@/harness/stack-playbooks'

export function registerMcpResources(server: McpServer, vault: ObsidianVault): void {
  server.registerResource(
    'wiki-schema',
    'aio://wiki/schema',
    {
      description:
        'Vault wiki schema (AGENTS.md). Prefer reading this resource over get_wiki_schema tool.',
      mimeType: 'text/markdown',
    },
    async () => {
      await vault.initialize()
      const content = await vault.readSchema()
      return {
        contents: [
          {
            uri: 'aio://wiki/schema',
            mimeType: 'text/markdown',
            text: content,
          },
        ],
      }
    }
  )

  server.registerResource(
    'stack-playbooks-index',
    'aio://wiki/stacks/index',
    {
      description: 'List of stack playbook IDs under vault/wiki/stacks/',
      mimeType: 'application/json',
    },
    async () => {
      const text = JSON.stringify({ stacks: ALL_STACK_IDS, count: ALL_STACK_IDS.length })
      return {
        contents: [
          {
            uri: 'aio://wiki/stacks/index',
            mimeType: 'application/json',
            text,
          },
        ],
      }
    }
  )
}
