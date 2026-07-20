import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]'
}

export const DEFAULT_JSON_BODY_LIMIT = 1024 * 1024

export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** True when the TCP peer is loopback (ignores Host header spoofing). */
export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false
  const a = addr
    .replace(/^::ffff:/i, '')
    .trim()
    .toLowerCase()
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

export function resolveBindAuthRequirement(opts: {
  bindHost: string
  tokenEnvKey: string
  allowInsecureEnvKey: string
  serviceName: string
}): { token: string | null; requireAuth: boolean } {
  const token = (process.env[opts.tokenEnvKey] || '').trim() || null
  const loopback = isLoopbackHost(opts.bindHost)
  if (!loopback) {
    if (!token && process.env[opts.allowInsecureEnvKey] !== '1') {
      throw new Error(
        `Refusing to bind ${opts.serviceName} on non-loopback host "${opts.bindHost}" without ${opts.tokenEnvKey}. ` +
          `Set ${opts.tokenEnvKey}, or ${opts.allowInsecureEnvKey}=1 to override (not recommended).`
      )
    }
    return { token, requireAuth: !!token }
  }
  return { token, requireAuth: !!token }
}

export function extractHttpToken(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i)
    if (m) return m[1].trim()
  }
  const headerToken = req.headers['x-aio-token']
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim()
  const q = url.searchParams.get('token')
  return q?.trim() || null
}

export function assertHttpAuthorized(
  req: IncomingMessage,
  url: URL,
  expectedToken: string | null,
  requireAuth: boolean
): void {
  if (!requireAuth || !expectedToken) return
  const got = extractHttpToken(req, url)
  if (!got || !timingSafeEqualString(got, expectedToken)) {
    const err = new Error('Unauthorized') as Error & { statusCode?: number }
    err.statusCode = 401
    throw err
  }
}

export function readLimitedJsonBody(
  req: IncomingMessage,
  limit = DEFAULT_JSON_BODY_LIMIT
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: string | Buffer) => {
      const buf = typeof c === 'string' ? Buffer.from(c) : c
      size += buf.length
      if (size > limit) {
        reject(new Error(`Request body exceeds ${limit} bytes`))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(JSON.parse(raw) as Record<string, unknown>)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    req.on('error', reject)
  })
}
