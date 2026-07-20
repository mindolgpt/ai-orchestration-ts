import type { IncomingMessage } from 'node:http'
import {
  resolveBindAuthRequirement,
  assertHttpAuthorized,
  extractHttpToken,
  isLoopbackAddress,
} from '@/security/http-auth'

export function resolveDashboardAuthRequirement(bindHost: string): {
  token: string | null
  requireAuth: boolean
} {
  return resolveBindAuthRequirement({
    bindHost,
    tokenEnvKey: 'AIO_DASHBOARD_TOKEN',
    allowInsecureEnvKey: 'AIO_DASHBOARD_ALLOW_INSECURE',
    serviceName: 'dashboard',
  })
}

export { assertHttpAuthorized as assertDashboardAuthorized, extractHttpToken, isLoopbackAddress }

/** POST mutations: loopback peer, or valid token when auth is enabled. */
export function assertDashboardMutationAllowed(
  req: IncomingMessage,
  url: URL,
  token: string | null,
  requireAuth: boolean
): void {
  if (requireAuth && token) {
    assertHttpAuthorized(req, url, token, true)
    return
  }
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    const err = new Error('Dashboard mutations allowed only from localhost') as Error & {
      statusCode?: number
    }
    err.statusCode = 403
    throw err
  }
}
