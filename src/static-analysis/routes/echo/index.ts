import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * Echo (Go) route extractor.
 *
 * Detects `e.GET("/path", ...)`, `g.POST("/path", ...)` style registrations.
 */

const ECHO_PATTERN =
  /\b\w+\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any)\s*\(\s*['"`]([^'"`]+)['"`]/g

export const echoRouteExtractor: RouteExtractorPlugin = {
  id: 'echo',
  languages: ['go'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let match: RegExpExecArray | null
      ECHO_PATTERN.lastIndex = 0
      while ((match = ECHO_PATTERN.exec(content)) !== null) {
        const method = match[1] === 'Any' ? 'GET' : (match[1].toUpperCase() as RouteInfo['method'])
        routes.push({
          method,
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

RouteExtractorRegistry.register(echoRouteExtractor)
