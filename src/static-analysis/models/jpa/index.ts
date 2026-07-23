import { ModelExtractorRegistry } from '../../plugin/registry'
import type { ModelExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ModelField, ModelInfo, ModelRelation } from '../../types'

/**
 * JPA / Hibernate (Java) entity extractor.
 *
 * Detects `@Entity` classes, `@Table(name=...)`, `@Id`, `@Column`,
 * `@ManyToOne`, `@OneToMany`, `@OneToOne`, `@ManyToMany`.
 */

const ENTITY_CLASS_PATTERN =
  /(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)\s*(?:extends\s+\w+\s*)?(?:implements\s+[^{]+\s*)?\{/g
const ENTITY_ANNOTATION_PATTERN = /@Entity\b/g
const TABLE_PATTERN = /@Table\s*\(\s*name\s*=\s*['"`]([^'"`]+)['"`]/g
const ID_PATTERN = /@Id\b[^;]*?private\s+(\w+)\s+(\w+)/g
const COLUMN_PATTERN = /@Column\s*\(([^)]*)\)\s*(?:private\s+|protected\s+)?(\w+)\s+(\w+)/g
const RELATION_PATTERNS: Array<{ kind: ModelRelation['kind']; pattern: RegExp }> = [
  {
    kind: 'one-to-one',
    pattern: /@OneToOne\s*\(\s*(?:[^)]*?targetEntity\s*=\s*(\w+)\.class|(\w+)\.class)?/g,
  },
  {
    kind: 'one-to-many',
    pattern: /@OneToMany\s*\(\s*(?:[^)]*?targetEntity\s*=\s*(\w+)\.class|(\w+)\.class)?/g,
  },
  {
    kind: 'many-to-one',
    pattern: /@ManyToOne\s*\(\s*(?:[^)]*?targetEntity\s*=\s*(\w+)\.class|(\w+)\.class)?/g,
  },
  {
    kind: 'many-to-many',
    pattern: /@ManyToMany\s*\(\s*(?:[^)]*?targetEntity\s*=\s*(\w+)\.class|(\w+)\.class)?/g,
  },
]

export const jpaModelExtractor: ModelExtractorPlugin = {
  id: 'jpa',
  languages: ['java'],
  extract(files: CodeFile[]): ModelInfo[] {
    const models: ModelInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      const entitySpans = findEntitySpans(content)
      for (const span of entitySpans) {
        const body = content.slice(span.start, span.end)
        models.push({
          name: span.className,
          file: file.path,
          tableName: span.tableName || span.className.toLowerCase(),
          fields: extractFields(body),
          relations: extractRelations(body),
          orm: 'jpa',
        })
      }
    }
    return models
  },
}

interface EntitySpan {
  className: string
  tableName?: string
  start: number
  end: number
}

function findEntitySpans(content: string): EntitySpan[] {
  const spans: EntitySpan[] = []
  let classMatch: RegExpExecArray | null
  ENTITY_CLASS_PATTERN.lastIndex = 0
  while ((classMatch = ENTITY_CLASS_PATTERN.exec(content)) !== null) {
    const className = classMatch[1]
    const classStart = classMatch.index
    const lookback = content.slice(Math.max(0, classStart - 300), classStart)
    ENTITY_ANNOTATION_PATTERN.lastIndex = 0
    if (!ENTITY_ANNOTATION_PATTERN.exec(lookback)) continue
    TABLE_PATTERN.lastIndex = 0
    const tableMatch = TABLE_PATTERN.exec(lookback)
    const tableName = tableMatch ? tableMatch[1] : undefined
    const bodyStart = classStart + classMatch[0].length
    const end = findClosingBrace(content, bodyStart)
    spans.push({ className, tableName, start: classStart, end })
  }
  return spans
}

function findClosingBrace(content: string, from: number): number {
  let depth = 1
  let i = from
  while (i < content.length && depth > 0) {
    const ch = content[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  }
  return i
}

function extractFields(body: string): ModelField[] {
  const fields: ModelField[] = []
  let m: RegExpExecArray | null
  ID_PATTERN.lastIndex = 0
  while ((m = ID_PATTERN.exec(body)) !== null) {
    fields.push({ name: m[2], type: m[1], isRequired: true, isUnique: false, isId: true })
  }
  COLUMN_PATTERN.lastIndex = 0
  while ((m = COLUMN_PATTERN.exec(body)) !== null) {
    const options = m[1]
    fields.push({
      name: m[3],
      type: m[2],
      isRequired: !options.includes('nullable = true') && !options.includes('nullable=true'),
      isUnique: options.includes('unique = true') || options.includes('unique=true'),
      isId: false,
    })
  }
  return fields
}

function extractRelations(body: string): ModelRelation[] {
  const relations: ModelRelation[] = []
  for (const { kind, pattern } of RELATION_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(body)) !== null) {
      const target = m[1] || m[2]
      if (target) relations.push({ kind, target, field: '' })
    }
  }
  return relations
}

ModelExtractorRegistry.register(jpaModelExtractor)
