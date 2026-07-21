import * as fs from 'fs'
import * as path from 'path'
import { ALL_TOOL_IDS } from '@/harness/tool-keywords'
import {
  hasIngestDocumentPayload,
  hasSubstantialIngestContent,
  MIN_INGEST_CONTENT_CHARS,
} from '@/knowledge/wiki-ingest-pipeline'

export { MIN_INGEST_CONTENT_CHARS }

const SESSION_ID_RE = /sess_[a-z0-9]+/i

export function extractPathFromMessage(message: string): string | undefined {
  const win = message.match(/[A-Za-z]:\\[^\s"'`,]+/)
  if (win) return win[0]
  const vaultRaw = message.match(/(?:\.\/)?vault\/raw\/[^\s"'`,]+\.(md|txt|json|yaml|yml)/i)
  if (vaultRaw) return vaultRaw[0]
  const quoted = message.match(/["'`]([^"'`]+?\.(?:md|txt|json|yaml|yml|csv|xml|html|htm))["'`]/i)
  if (quoted) return quoted[1]
  const unix = message.match(/(?:\.?\/)?[\w./-]+\.(md|txt|json|yaml|yml|csv|xml|html|htm)/i)
  return unix?.[0]
}

export function extractRawIdFromMessage(message: string): string | undefined {
  const explicit = message.match(/\braw_id\s*[=:]\s*([a-z0-9]{6,12})\b/i)
  if (explicit) return explicit[1]
  const fromPath = message.match(/\braw\/([a-z0-9]{6,12})--/i)
  if (fromPath) return fromPath[1]
  const bare = message.match(/\b(?:raw\s*id|rawid)\s+([a-z0-9]{6,12})\b/i)
  return bare?.[1]
}

export function looksLikeReingestRequest(message: string): boolean {
  return /(다시|재\s*ingest|re-?ingest|기존\s*raw|raw\s*파일\s*보고|from\s+raw|skip_raw)/i.test(
    message
  )
}

/** Resolve README.md → projectRoot/README.md when the file exists. */
export function resolveIngestFilePath(filePath: string, projectRoot: string): string {
  const trimmed = filePath.trim()
  if (path.isAbsolute(trimmed)) return trimmed
  const candidates = [
    path.join(projectRoot, trimmed),
    path.join(projectRoot, 'docs', trimmed),
    path.join(projectRoot, 'vault', trimmed),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return path.join(projectRoot, trimmed)
}

export function enrichIngestParams(
  params: Record<string, unknown>,
  message: string,
  projectRoot: string
): Record<string, unknown> {
  const p = { ...params }
  const filePath = typeof p.file_path === 'string' ? p.file_path : extractPathFromMessage(message)
  if (filePath) {
    p.file_path = resolveIngestFilePath(filePath, projectRoot)
  }
  const rawId = typeof p.raw_id === 'string' ? p.raw_id : extractRawIdFromMessage(message)
  if (rawId) {
    p.raw_id = rawId
    if (looksLikeReingestRequest(message)) p.skip_raw = true
  }
  const sess = message.match(SESSION_ID_RE)
  if (sess) p.session_id = sess[0]
  return p
}

export function ingestPayloadReady(
  params: Record<string, unknown>,
  message: string,
  projectRoot: string
): boolean {
  const p = enrichIngestParams(params, message, projectRoot)
  return hasIngestDocumentPayload({
    content: typeof p.content === 'string' ? p.content : undefined,
    file_path: typeof p.file_path === 'string' ? p.file_path : undefined,
    raw_id: typeof p.raw_id === 'string' ? p.raw_id : undefined,
    skip_raw: p.skip_raw === true,
  })
}

/** Match explicit tool id mentioned in free text (longest id wins). */
export function tryExplicitToolFromMessage(message: string): string | undefined {
  const lower = message.toLowerCase()
  for (const id of [...ALL_TOOL_IDS].sort((a, b) => b.length - a.length)) {
    const spaced = id.replace(/_/g, ' ')
    if (lower.includes(id) || lower.includes(spaced)) return id
  }
  return undefined
}

export function inferApprovalFromMessage(message: string): boolean | undefined {
  if (/\b(approve|approved|ok|yes)\b/i.test(message)) return true
  if (/(승인|허용)/.test(message)) return true
  if (/\b(reject|rejected|deny|denied|no)\b/i.test(message)) return false
  if (/(거부|반려|아니)/.test(message)) return false
  return undefined
}

export function inferReportStatus(message: string): 'completed' | 'failed' | undefined {
  if (/\b(fail|failed|error|실패)\b/i.test(message)) return 'failed'
  if (/\b(done|complete|completed|success|완료|성공)\b/i.test(message)) return 'completed'
  return undefined
}

export function extractConfirmCode(message: string): string | undefined {
  return message.match(/\b(?:confirm[_ ]?code|코드|code)[:\s]*([a-f0-9]{16})\b/i)?.[1]
}

export function hasSubstantialContent(params: Record<string, unknown>): boolean {
  return hasSubstantialIngestContent(
    typeof params.content === 'string' ? params.content : undefined
  )
}
