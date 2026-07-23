import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * Axum (Rust) route extractor.
 *
 * Detects `.route("/path", get(handler))`, `.route("/path", post(handler))`,
 * `.route("/path", method_router)` chains. Axum's method routers are
 * `get`/`post`/`put`/`delete`/`patch`/`head`/`options`.
 */

const AXUM_PATTERN =
  /\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(get|post|put|delete|patch|head|options)\s*\(\s*([^)]+)\s*\)/gi

export const axumRouteExtractor: RouteExtractorPlugin = {
  id: 'axum',
  languages: ['rust'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let match: RegExpExecArray | null
      AXUM_PATTERN.lastIndex = 0
      while ((match = AXUM_PATTERN.exec(content)) !== null) {
        routes.push({
          method: match[2].toUpperCase() as RouteInfo['method'],
          path: match[1],
          handler: match[3].trim(),
          handlerFile: file.path,
          middlewares: [],
        })
      }
    }
    return routes
  },
}

RouteExtractorRegistry.register(axumRouteExtractor)
