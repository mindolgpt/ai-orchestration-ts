import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * Gin (Go) route extractor.
 *
 * Detects `r.GET("/path", ...)`, `router.POST("/path", ...)`,
 * `group.GET("/path", ...)` style registrations.
 */

const GIN_PATTERN =
  /\b\w+\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any)\s*\(\s*['"`]([^'"`]+)['"`]/g

export const ginRouteExtractor: RouteExtractorPlugin = {
  id: 'gin',
  languages: ['go'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let match: RegExpExecArray | null
      GIN_PATTERN.lastIndex = 0
      while ((match = GIN_PATTERN.exec(content)) !== null) {
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

RouteExtractorRegistry.register(ginRouteExtractor)
