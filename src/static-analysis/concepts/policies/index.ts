import { ConceptExtractorRegistry } from '../../plugin/registry'
import type { ConceptExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ConceptInfo } from '../../types'

/**
 * Policy / rule / specification concept extractor.
 *
 * Identifies domain policies, rules, specifications and validators from
 * class/struct/function names: `*Policy`, `*Rule`, `*Specification`,
 * `*Validator`, `*Guard`, `*Constraint`.
 */

const NAME_PATTERNS = [/Policy$/, /Rule$/, /Specification$/, /Validator$/, /Guard$/, /Constraint$/]

export const policiesConceptExtractor: ConceptExtractorPlugin = {
  id: 'policies',
  languages: ['typescript', 'python', 'java', 'go', 'rust'],
  extract(files: CodeFile[]): ConceptInfo[] {
    const concepts: ConceptInfo[] = []
    for (const file of files) {
      for (const cls of file.classes) {
        if (NAME_PATTERNS.some((p) => p.test(cls.name))) {
          concepts.push({
            kind:
              cls.name.endsWith('Validator') || cls.name.endsWith('Constraint')
                ? 'policy'
                : cls.name.endsWith('Guard')
                  ? 'policy'
                  : 'rule',
            name: cls.name,
            file: file.path,
            language: file.language,
            summary: `${cls.name} (${file.language})`,
            related: cls.implements,
          })
        }
      }
      for (const fn of file.functions) {
        if (NAME_PATTERNS.some((p) => p.test(fn.name))) {
          concepts.push({
            kind: 'rule',
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

ConceptExtractorRegistry.register(policiesConceptExtractor)
