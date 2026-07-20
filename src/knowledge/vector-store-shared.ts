import { KnowledgeDoc } from '@/knowledge/types'

export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return fallback
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value)
        return asStringArray(parsed)
      } catch {
        return []
      }
    }
    return []
  }
  return value.map((v) => asString(v)).filter(Boolean)
}

export function docToPayload(doc: KnowledgeDoc): Record<string, unknown> {
  return {
    path: doc.path,
    title: doc.title,
    content: doc.content,
    tags: doc.tags,
    links: doc.links,
    createdAt: doc.createdAt,
  }
}

export function payloadToDoc(payload: Record<string, unknown>): KnowledgeDoc {
  return {
    path: asString(payload.path),
    title: asString(payload.title),
    content: asString(payload.content),
    tags: asStringArray(payload.tags),
    links: asStringArray(payload.links),
    createdAt: asString(payload.createdAt, new Date().toISOString()),
  }
}

export async function httpJson(
  url: string,
  opts: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
    label?: string
  } = {}
): Promise<unknown> {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const label = opts.label || 'HTTP'
    throw new Error(
      `${label} ${opts.method || 'GET'} ${url} failed (${res.status}): ${text.slice(0, 400)}`
    )
  }
  return json
}
