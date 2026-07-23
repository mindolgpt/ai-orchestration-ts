import { ConceptExtractorRegistry } from '../../plugin/registry'
import type { ConceptExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ConceptInfo } from '../../types'

/**
 * Domain event concept extractor.
 *
 * Identifies events from class/struct names (`*Event`, `*DomainEvent`,
 * `*Occurred`) and from emit/publish/dispatch call sites in the raw source.
 */

const EVENT_NAME_PATTERNS = [/Event$/, /DomainEvent$/, /Occurred$/]
const EMIT_PATTERNS = [
  /\bemit\s*\(\s*new\s+(\w+)/g,
  /\bpublish\s*\(\s*new\s+(\w+)/g,
  /\bdispatch\s*\(\s*new\s+(\w+)/g,
  /\beventBus\.publish\s*\(\s*['"`]([^'"`]+)['"`]/g,
]

export const eventsConceptExtractor: ConceptExtractorPlugin = {
  id: 'events',
  languages: ['typescript', 'python', 'java', 'go', 'rust'],
  extract(files: CodeFile[]): ConceptInfo[] {
    const concepts: ConceptInfo[] = []
    const seen = new Set<string>()
    for (const file of files) {
      for (const cls of file.classes) {
        if (EVENT_NAME_PATTERNS.some((p) => p.test(cls.name))) {
          const key = `${file.path}#${cls.name}`
          if (seen.has(key)) continue
          seen.add(key)
          concepts.push({
            kind: 'event',
            name: cls.name,
            file: file.path,
            language: file.language,
            summary: `Domain event ${cls.name} (${file.language})`,
          })
        }
      }
      const content = file.rawContent ?? ''
      if (content) {
        for (const pattern of EMIT_PATTERNS) {
          pattern.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = pattern.exec(content)) !== null) {
            const name = m[1]
            const key = `${file.path}#${name}`
            if (seen.has(key)) continue
            seen.add(key)
            concepts.push({
              kind: 'event',
              name,
              file: file.path,
              language: file.language,
              summary: `Event ${name} emitted in ${file.path}`,
            })
          }
        }
      }
    }
    return concepts
  },
}

ConceptExtractorRegistry.register(eventsConceptExtractor)
