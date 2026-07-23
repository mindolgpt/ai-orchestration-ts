import { ConceptExtractorRegistry } from '../../plugin/registry'
import type { ConceptExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ConceptInfo } from '../../types'

/**
 * Use case / application service concept extractor.
 *
 * Heuristically identifies use cases and application services from class /
 * struct / function names: `*UseCase`, `*Service`, `*Handler`, `*Command`,
 * `*Query`, `*Application`. Language-agnostic — works across TS/Python/
 * Java/Go/Rust because it keys off the parsed `classes`/`functions` lists
 * populated by each language plugin.
 */

const NAME_PATTERNS = [
  /UseCase$/,
  /Service$/,
  /Handler$/,
  /Command$/,
  /Query$/,
  /Application$/,
  /Controller$/,
]

export const usecaseConceptExtractor: ConceptExtractorPlugin = {
  id: 'usecase',
  languages: ['typescript', 'python', 'java', 'go', 'rust'],
  extract(files: CodeFile[]): ConceptInfo[] {
    const concepts: ConceptInfo[] = []
    for (const file of files) {
      for (const cls of file.classes) {
        if (NAME_PATTERNS.some((p) => p.test(cls.name))) {
          concepts.push({
            kind:
              cls.name.endsWith('Command') || cls.name.endsWith('Query')
                ? 'usecase'
                : cls.name.endsWith('Service')
                  ? 'service'
                  : 'usecase',
            name: cls.name,
            file: file.path,
            language: file.language,
            summary: `${cls.name} (${file.language})`,
            related: cls.extends ? [cls.extends] : undefined,
          })
        }
      }
      for (const fn of file.functions) {
        if (NAME_PATTERNS.some((p) => p.test(fn.name))) {
          concepts.push({
            kind: 'usecase',
            name: fn.name,
            file: file.path,
            language: file.language,
            summary: `${fn.name}() (${file.language})`,
          })
        }
      }
    }
    return concepts
  },
}

ConceptExtractorRegistry.register(usecaseConceptExtractor)
