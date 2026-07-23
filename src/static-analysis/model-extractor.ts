import { ModelExtractorRegistry } from './plugin/registry'
import type { AnalysisPluginOptions } from './plugin/types'
import type { CodeFile, ModelInfo } from './types'

/**
 * Registry-based model extractor dispatcher.
 *
 * Replaces the legacy TS-only extractor (which had a `content = ''` bug that
 * matched nothing for Prisma/Mongoose). Models are extracted by every
 * registered {@link ModelExtractorPlugin} applicable to the languages present
 * in `files`, then de-duplicated by `(name, file)` so overlapping matchers
 * don't produce duplicates.
 *
 * Public API (`parseModels`) is preserved for graph-builder / index callers.
 */
export function parseModels(files: CodeFile[], opts?: AnalysisPluginOptions): ModelInfo[] {
  const languageIds = collectLanguages(files, opts?.languages)
  const extractors = ModelExtractorRegistry.forLanguages(languageIds)
  const seen = new Set<string>()
  const models: ModelInfo[] = []
  for (const extractor of extractors) {
    const extracted = extractor.extract(files)
    for (const m of extracted) {
      const key = `${m.name} @ ${m.file}`
      if (seen.has(key)) continue
      seen.add(key)
      models.push(m)
    }
  }
  return models
}

function collectLanguages(files: CodeFile[], filter?: string[]): string[] {
  const present = new Set<string>()
  for (const f of files) if (f.language) present.add(f.language)
  if (!filter || filter.length === 0) return Array.from(present)
  const filterSet = new Set(filter)
  return Array.from(present).filter((l) => filterSet.has(l))
}
