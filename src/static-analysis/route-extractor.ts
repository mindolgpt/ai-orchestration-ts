import { CodeFile, RouteInfo } from './types'

const ROUTE_DECORATOR_PATTERN =
  /@(Get|Post|Put|Patch|Delete|Head|Options|Route)\s*\(['"`]([^'"`]+)['"`]\)/g
const EXPRESS_PATTERN =
  /(?:router|app)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi
const FASTIFY_PATTERN =
  /(?:app|server|fastify)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi

export function parseRoutes(files: CodeFile[]): RouteInfo[] {
  const routes: RouteInfo[] = []

  for (const file of files) {
    try {
      const decoratorRoutes = extractDecoratorRoutes(
        file.path,
        file.decorators?.map?.((d) => `${d.name}(${d.arguments || ''})`).join('\n') || ''
      )
      routes.push(...decoratorRoutes)

      const expressRoutes = extractPatternRoutes(file.path, EXPRESS_PATTERN)
      routes.push(...expressRoutes)

      const fastifyRoutes = extractPatternRoutes(file.path, FASTIFY_PATTERN)
      routes.push(...fastifyRoutes)
    } catch {
      // skip parse errors
    }
  }
  return routes
}

function extractDecoratorRoutes(filePath: string, decoratorsText: string): RouteInfo[] {
  const routes: RouteInfo[] = []
  let match: RegExpExecArray | null
  ROUTE_DECORATOR_PATTERN.lastIndex = 0
  while ((match = ROUTE_DECORATOR_PATTERN.exec(decoratorsText)) !== null) {
    routes.push({
      method: match[1].toUpperCase() as RouteInfo['method'],
      path: match[2],
      handler: filePath,
      handlerFile: filePath,
      middlewares: [],
    })
  }
  return routes
}

function extractPatternRoutes(filePath: string, pattern: RegExp): RouteInfo[] {
  const routes: RouteInfo[] = []
  let match: RegExpExecArray | null
  pattern.lastIndex = 0
  while ((match = pattern.exec('')) !== null) {
    routes.push({
      method: match[1].toUpperCase() as RouteInfo['method'],
      path: match[2],
      handler: filePath,
      handlerFile: filePath,
      middlewares: [],
    })
  }
  return routes
}
