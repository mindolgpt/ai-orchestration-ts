import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * Django (Python) URL extractor.
 *
 * Detects `path('url/', view)` and `re_path(r'^url$', view)` entries inside
 * `urlpatterns = [...]`. Django routes don't carry an HTTP method (the view
 * dispatches internally), so `method` defaults to GET.
 */

const PATH_PATTERN = /\bpath\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([\w.]+)/g
const REPATH_PATTERN = /\bre_path\s*\(\s*r?['"`]([^'"`]+)['"`]\s*,\s*([\w.]+)/g

export const djangoRouteExtractor: RouteExtractorPlugin = {
  id: 'django',
  languages: ['python'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      // Only scan inside urlpatterns blocks to avoid false positives.
      const block = extractUrlpatternsBlock(content)
      const target = block || content
      let match: RegExpExecArray | null
      PATH_PATTERN.lastIndex = 0
      while ((match = PATH_PATTERN.exec(target)) !== null) {
        routes.push({
          method: 'GET',
          path: match[1],
          handler: match[2],
          handlerFile: file.path,
          middlewares: [],
        })
      }
      REPATH_PATTERN.lastIndex = 0
      while ((match = REPATH_PATTERN.exec(target)) !== null) {
        routes.push({
          method: 'GET',
          path: match[1],
          handler: match[2],
          handlerFile: file.path,
          middlewares: [],
        })
      }
    }
    return routes
  },
}

function extractUrlpatternsBlock(content: string): string | null {
  const startIdx = content.indexOf('urlpatterns')
  if (startIdx < 0) return null
  const bracketStart = content.indexOf('[', startIdx)
  if (bracketStart < 0) return null
  let depth = 1
  let i = bracketStart + 1
  while (i < content.length && depth > 0) {
    if (content[i] === '[') depth++
    else if (content[i] === ']') depth--
    i++
  }
  return content.slice(bracketStart, i)
}

RouteExtractorRegistry.register(djangoRouteExtractor)
