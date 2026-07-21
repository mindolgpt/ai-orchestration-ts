import { jsonResult } from '@/mcp/json-result'

/** Unified MCP tool error payload for agents. */
export interface AioToolError {
  ok: false
  error: string
  hint?: string
  fix?: string
}

export function aioToolError(error: string, opts?: { hint?: string; fix?: string }): AioToolError {
  return { ok: false, error, ...opts }
}

export function jsonErrorResult(error: string, opts?: { hint?: string; fix?: string }) {
  return jsonResult(aioToolError(error, opts))
}
