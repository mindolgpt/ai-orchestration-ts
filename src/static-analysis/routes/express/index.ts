import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * Express route extractor.
 *
 * Detects `router.get('/path', ...)`, `app.post('/path', ...)`, etc. Runs
 * against `file.rawContent` (fixes the legacy `pattern.exec('')` bug that
 * matched nothing).
 */

const EXPRESS_PATTERN =
  /(?:router|app)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi

export const expressRouteExtractor: RouteExtractorPlugin = {
  id: 'express',
  languages: ['typescript'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let match: RegExpExecArray | null
      EXPRESS_PATTERN.lastIndex = 0
      while ((match = EXPRESS_PATTERN.exec(content)) !== null) {
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

RouteExtractorRegistry.register(expressRouteExtractor)
