import { ModelExtractorRegistry } from '../../plugin/registry'
import type { ModelExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ModelField, ModelInfo, ModelRelation } from '../../types'

/**
 * Django ORM (Python) model extractor.
 *
 * Detects classes inheriting from `models.Model` and `Field` declarations
 * of the form `name = models.CharField(...)`. ForeignKey/ManyToManyField
 * become relations.
 */

const CLASS_PATTERN = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/gm
const FIELD_PATTERN = /(\w+)\s*=\s*models\.(\w+)\s*\(([^)]*)\)/g
const RELATION_FIELD_TYPES = new Set(['ForeignKey', 'OneToOneField', 'ManyToManyField'])

export const djangoOrmModelExtractor: ModelExtractorPlugin = {
  id: 'django-orm',
  languages: ['python'],
  extract(files: CodeFile[]): ModelInfo[] {
    const models: ModelInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      const classSpans = findClassSpans(content)
      for (const span of classSpans) {
        if (!/models\.Model/.test(span.bases)) continue
        const body = content.slice(span.start, span.end)
        const { fields, relations } = extractFieldsAndRelations(body)
        models.push({
          name: span.className,
          file: file.path,
          tableName: span.className.toLowerCase(),
          fields,
          relations,
          orm: 'django-orm',
        })
      }
    }
    return models
  },
}

interface ClassSpan {
  className: string
  bases: string
  start: number
  end: number
}

function findClassSpans(content: string): ClassSpan[] {
  const spans: ClassSpan[] = []
  let m: RegExpExecArray | null
  CLASS_PATTERN.lastIndex = 0
  while ((m = CLASS_PATTERN.exec(content)) !== null) {
    const className = m[1]
    const bases = m[2]
    const classStart = m.index
    const bodyStart = classStart + m[0].length
    const end = findClassEnd(content, bodyStart)
    spans.push({ className, bases, start: classStart, end })
  }
  return spans
}

function findClassEnd(content: string, from: number): number {
  const rest = content.slice(from)
  const nextDef = /^(?:class\s+\w+|def\s+\w+|@)/m.exec(rest)
  if (nextDef) return from + nextDef.index
  return content.length
}

function extractFieldsAndRelations(body: string): {
  fields: ModelField[]
  relations: ModelRelation[]
} {
  const fields: ModelField[] = []
  const relations: ModelRelation[] = []
  let m: RegExpExecArray | null
  FIELD_PATTERN.lastIndex = 0
  while ((m = FIELD_PATTERN.exec(body)) !== null) {
    const name = m[1]
    const type = m[2]
    const args = m[3]
    if (RELATION_FIELD_TYPES.has(type)) {
      const targetMatch = /['"`]([^'"`]+)['"`]/.exec(args)
      const target = targetMatch ? targetMatch[1] : ''
      const kind =
        type === 'ForeignKey'
          ? 'many-to-one'
          : type === 'OneToOneField'
            ? 'one-to-one'
            : 'many-to-many'
      relations.push({ kind, target, field: name })
    } else {
      fields.push({
        name,
        type,
        isRequired: !args.includes('null=True'),
        isUnique: args.includes('unique=True'),
        isId: name === 'id' || args.includes('primary_key=True'),
      })
    }
  }
  return { fields, relations }
}

ModelExtractorRegistry.register(djangoOrmModelExtractor)
