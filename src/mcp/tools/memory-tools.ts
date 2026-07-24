import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { MemoryStore } from '@/memory'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

export function registerMemoryTools(server: McpServer): void {
  const root = resolveProjectRoot()
  const store = new MemoryStore(root)

  registerMcpTool(
    server,
    'memory_set',
    {
      description:
        '메모리 기록: why/correction/constraint/context 타입을 특정 anchor(document/epic/spec/code)에 연결.',
      inputSchema: z.object({
        kind: z.enum(['why', 'correction', 'constraint', 'context']),
        anchor_type: z.enum(['document', 'epic', 'spec', 'code']),
        anchor_id: z.string(),
        content: z.string(),
        confidence: z.enum(['proposed', 'confirmed']).optional(),
        author: z.string().optional(),
      }),
    },
    async (args) => {
      const entry = await store.set(
        args.kind,
        args.anchor_type,
        args.anchor_id,
        args.content,
        args.author || 'user',
        args.confidence || 'proposed'
      )
      return jsonResult({
        ok: true,
        id: entry.id,
        kind: entry.kind,
        anchor_type: entry.anchorType,
        anchor_id: entry.anchorId,
        version: entry.version,
        recorded_at: new Date(entry.provenance.recordedAt).toISOString(),
      })
    }
  )

  registerMcpTool(
    server,
    'memory_get',
    {
      description: '특정 anchor에 연결된 모든 메모리 조회.',
      inputSchema: z.object({
        anchor_type: z.enum(['document', 'epic', 'spec', 'code']),
        anchor_id: z.string(),
        include_superseded: z.boolean().optional(),
      }),
    },
    async (args) => {
      const entries = await store.getByAnchor(
        args.anchor_type,
        args.anchor_id,
        args.include_superseded
      )
      return jsonResult({
        anchor_type: args.anchor_type,
        anchor_id: args.anchor_id,
        entries: entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          content: e.content,
          author: e.provenance.author,
          confidence: e.provenance.confidence,
          version: e.version,
          recorded_at: new Date(e.provenance.recordedAt).toISOString(),
        })),
        total: entries.length,
      })
    }
  )

  registerMcpTool(
    server,
    'memory_search',
    {
      description: '메모리 내용 검색.',
      inputSchema: z.object({
        query: z.string(),
        kinds: z.array(z.enum(['why', 'correction', 'constraint', 'context'])).optional(),
      }),
    },
    async (args) => {
      const results = await store.search(args.query, args.kinds)
      return jsonResult({
        query: args.query,
        results: results.map((r) => ({
          id: r.id,
          kind: r.kind,
          anchor_type: r.anchorType,
          anchor_id: r.anchorId,
          snippet: r.snippet,
          score: r.score,
        })),
        total: results.length,
      })
    }
  )

  registerMcpTool(
    server,
    'memory_update',
    {
      description: '메모리 내용 업데이트 (새 버전 생성, 이전 버전 superseded 표시).',
      inputSchema: z.object({
        id: z.string(),
        content: z.string(),
        confidence: z.enum(['proposed', 'confirmed']).optional(),
        author: z.string().optional(),
      }),
    },
    async (args) => {
      const entry = await store.update(
        args.id,
        args.content,
        args.author || 'user',
        args.confidence
      )
      if (!entry) return jsonResult({ ok: false, error: `Memory ${args.id} not found` })
      return jsonResult({
        id: entry.id,
        version: entry.version,
        kind: entry.kind,
        recorded_at: new Date(entry.provenance.recordedAt).toISOString(),
      })
    }
  )

  registerMcpTool(
    server,
    'memory_delete',
    {
      description: '메모리 삭제 (soft delete).',
      inputSchema: z.object({
        id: z.string(),
        permanent: z.boolean().optional(),
      }),
    },
    async (args) => {
      const ok = await store.delete(args.id, !args.permanent)
      return jsonResult({ deleted: ok })
    }
  )
}
