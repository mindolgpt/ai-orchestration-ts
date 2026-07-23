import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * Spring (Java/Kotlin) route extractor.
 *
 * Detects `@RequestMapping`, `@GetMapping`, `@PostMapping`, ... on methods,
 * composing with the class-level `@RequestMapping("/base")` prefix when
 * present. Captures the controller class name.
 */

const MAPPING_ANNOTATIONS = [
  'RequestMapping',
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'PatchMapping',
  'DeleteMapping',
]
const METHOD_MAP: Record<string, RouteInfo['method']> = {
  RequestMapping: 'GET',
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  PatchMapping: 'PATCH',
  DeleteMapping: 'DELETE',
}
const MAPPING_PATTERN = new RegExp(
  `@(${MAPPING_ANNOTATIONS.join('|')})\\s*\\(\\s*(?:value\\s*=\\s*)?['"\`]([^'"\`]+)['"\`]`,
  'g'
)
const CLASS_MAPPING_PATTERN = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]*)['"`]/g
const CLASS_PATTERN = /(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)/g

export const springRouteExtractor: RouteExtractorPlugin = {
  id: 'spring',
  languages: ['java'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      const classBase = findClassMapping(content)
      const className = findClassName(content)
      let match: RegExpExecArray | null
      MAPPING_PATTERN.lastIndex = 0
      while ((match = MAPPING_PATTERN.exec(content)) !== null) {
        const annotation = match[1]
        const sub = match[2]
        routes.push({
          method: METHOD_MAP[annotation] || 'GET',
          path: composePath(classBase, sub),
          handler: file.path,
          handlerFile: file.path,
          middlewares: [],
          controller: className,
        })
      }
    }
    return routes
  },
}

function findClassMapping(content: string): string {
  CLASS_MAPPING_PATTERN.lastIndex = 0
  const m = CLASS_MAPPING_PATTERN.exec(content)
  return m ? m[1] : ''
}

function findClassName(content: string): string | undefined {
  CLASS_PATTERN.lastIndex = 0
  const m = CLASS_PATTERN.exec(content)
  return m ? m[1] : undefined
}

function composePath(base: string, sub: string): string {
  if (!base) return sub.startsWith('/') ? sub : `/${sub}`
  if (sub.startsWith('/')) return `${base}${sub}`
  return `${base}/${sub}`
}

RouteExtractorRegistry.register(springRouteExtractor)
