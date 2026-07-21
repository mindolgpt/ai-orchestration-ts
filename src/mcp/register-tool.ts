import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import { shouldRegisterTool } from '@/mcp/tool-tiers'

export interface McpToolConfig {
  title?: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

/** MCP tool handler — args shape validated at runtime by inputSchema. */
export type McpToolHandler<TArgs = Record<string, unknown>> = (
  args: TArgs,
  extra?: unknown
) => unknown

/** Skip registration when AIO_MCP_TOOL_SET excludes this tool. */
export function registerMcpTool<TSchema extends z.ZodTypeAny>(
  server: McpServer,
  name: string,
  config: Omit<McpToolConfig, 'inputSchema'> & { inputSchema: TSchema },
  handler: McpToolHandler<z.infer<TSchema>>
): void {
  if (!shouldRegisterTool(name)) return
  // MCP SDK registerTool generics don't compose cleanly with zod object schemas.
  const register = server.registerTool.bind(server) as (
    toolName: string,
    toolConfig: unknown,
    toolHandler: unknown
  ) => void
  register(name, config, handler)
}
