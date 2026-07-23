import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * FastAPI (Python) route extractor.
 *
 * Detects `@app.get("/path")`, `@router.post("/path")`, etc. Runs against
 * `file.rawContent`.
 */

const FASTAPI_PATTERN =
  /@(app|router|api_router)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi

export const fastapiRouteExtractor: RouteExtractorPlugin = {
  id: 'fastapi',
  languages: ['python'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let match: RegExpExecArray | null
      FASTAPI_PATTERN.lastIndex = 0
      while ((match = FASTAPI_PATTERN.exec(content)) !== null) {
        routes.push({
          method: match[2].toUpperCase() as RouteInfo['method'],
          path: match[3],
          handler: file.path,
          handlerFile: file.path,
          middlewares: [],
        })
      }
    }
    return routes
  },
}

RouteExtractorRegistry.register(fastapiRouteExtractor)
