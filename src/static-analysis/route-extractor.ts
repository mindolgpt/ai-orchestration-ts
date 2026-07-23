import { RouteExtractorRegistry } from './plugin/registry'
import type { AnalysisPluginOptions } from './plugin/types'
import type { CodeFile, RouteInfo } from './types'

/**
 * Registry-based route extractor dispatcher.
 *
 * Replaces the legacy TS-only extractor (which had a `pattern.exec('')` bug
 * that matched nothing for Express/Fastify). Routes are extracted by every
 * registered {@link RouteExtractorPlugin} applicable to the languages present
 * in `files`, then de-duplicated by `(method, path, handlerFile)` so
 * overlapping framework matchers (e.g. Gin/Echo share the same call shape)
 * don't produce duplicate entries.
 *
 * Public API (`parseRoutes`) is preserved for graph-builder / index callers.
 */
export function parseRoutes(files: CodeFile[], opts?: AnalysisPluginOptions): RouteInfo[] {
  const languageIds = collectLanguages(files, opts?.languages)
  const extractors = RouteExtractorRegistry.forLanguages(languageIds)
  const seen = new Set<string>()
  const routes: RouteInfo[] = []
  for (const extractor of extractors) {
    const extracted = extractor.extract(files)
    for (const r of extracted) {
      const key = `${r.method} ${r.path} @ ${r.handlerFile}`
      if (seen.has(key)) continue
      seen.add(key)
      routes.push(r)
    }
  }
  return routes
}

function collectLanguages(files: CodeFile[], filter?: string[]): string[] {
  const present = new Set<string>()
  for (const f of files) if (f.language) present.add(f.language)
  if (!filter || filter.length === 0) return Array.from(present)
  const filterSet = new Set(filter)
  return Array.from(present).filter((l) => filterSet.has(l))
}
