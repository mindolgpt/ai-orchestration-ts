import { RouteExtractorRegistry } from '../../plugin/registry'
import type { RouteExtractorPlugin } from '../../plugin/types'
import type { CodeFile, RouteInfo } from '../../types'

/**
 * NestJS route extractor.
 *
 * Detects `@Get('/path')`, `@Post('/path')`, ... decorators on controller
 * methods. Runs against `file.rawContent` (not the empty string) so routes
 * are actually matched. Also captures the enclosing `@Controller('/base')`
 * prefix when present to compose the full path.
 */

const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'Route']
const ROUTE_DECORATOR_PATTERN = new RegExp(
  `@(${HTTP_DECORATORS.join('|')})\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`,
  'g'
)
const CONTROLLER_PATTERN = /@Controller\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/g
const CLASS_PATTERN = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g

export const nestjsRouteExtractor: RouteExtractorPlugin = {
  id: 'nestjs',
  languages: ['typescript'],
  extract(files: CodeFile[]): RouteInfo[] {
    const routes: RouteInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      const controllerBase = findControllerBase(content)
      const className = findClassName(content)
      let match: RegExpExecArray | null
      ROUTE_DECORATOR_PATTERN.lastIndex = 0
      while ((match = ROUTE_DECORATOR_PATTERN.exec(content)) !== null) {
        const method = match[1].toUpperCase() as RouteInfo['method']
        const sub = match[2]
        routes.push({
          method,
          path: composePath(controllerBase, sub),
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

function findControllerBase(content: string): string {
  CONTROLLER_PATTERN.lastIndex = 0
  const m = CONTROLLER_PATTERN.exec(content)
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

RouteExtractorRegistry.register(nestjsRouteExtractor)
