import type { IncomingMessage } from 'node:http'
import { isLoopbackHost, extractHttpToken, assertHttpAuthorized } from '@/security/http-auth'

export { isLoopbackHost }

/**
 * Non-loopback SSE requires AIO_SSE_TOKEN (or explicit AIO_SSE_ALLOW_INSECURE=1).
 * Returns the token that must be presented, or null if auth is not required.
 */
export function resolveSseAuthRequirement(bindHost: string): {
  token: string | null
  requireAuth: boolean
} {
  const token = (process.env.AIO_SSE_TOKEN || '').trim() || null
  const loopback = isLoopbackHost(bindHost)
  if (!loopback) {
    if (!token && process.env.AIO_SSE_ALLOW_INSECURE !== '1') {
      throw new Error(
        `Refusing to bind MCP SSE on non-loopback host "${bindHost}" without AIO_SSE_TOKEN. ` +
          `Set AIO_SSE_TOKEN, or AIO_SSE_ALLOW_INSECURE=1 to override (not recommended).`
      )
    }
    return { token, requireAuth: !!token }
  }
  return { token, requireAuth: !!token }
}

export function extractSseToken(req: IncomingMessage, url: URL): string | null {
  return extractHttpToken(req, url)
}

export function assertSseAuthorized(
  req: IncomingMessage,
  url: URL,
  expectedToken: string | null,
  requireAuth: boolean
): void {
  assertHttpAuthorized(req, url, expectedToken, requireAuth)
}
