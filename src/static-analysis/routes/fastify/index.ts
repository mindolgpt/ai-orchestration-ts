import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * Fastify route extractor.
 *
 * Detects `app.get('/path', ...)`, `server.post('/path', ...)`,
 * `fastify.get('/path', ...)`. Runs against `file.rawContent` (fixes the
 * legacy `pattern.exec('')` bug).
 */

const FASTIFY_PATTERN =
  /(?:app|server|fastify)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi

export const fastifyRouteExtractor: RouteExtractorPlugin = {
  id: 'fastify',
  languages: ['typescript'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let match: RegExpExecArray | null
      FASTIFY_PATTERN.lastIndex = 0
      while ((match = FASTIFY_PATTERN.exec(content)) !== null) {
        routes.push({
          method: match[1].toUpperCase() as RouteInfo['method'],
          path: match[2],
          handler: file.path,
          handlerFile: file.path,
          middlewares: [],
        })
      }
    }
    return routes
  },
}

RouteExtractorRegistry.register(fastifyRouteExtractor)
