import { ModelExtractorRegistry } from '../../plugin/registry'
import type { ModelExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ModelField, ModelInfo, ModelRelation } from '../../types'

/**
 * TypeORM entity extractor.
 *
 * Detects classes decorated with `@Entity()` and populates fields/relations
 * from `@Column()` / `@OneToMany()` / `@ManyToOne()` / `@ManyToMany()`
 * decorators. The legacy implementation only captured the class name and
 * left fields/relations empty.
 */

const ENTITY_CLASS_PATTERN =
  /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)\s*(?:extends\s+\w+\s*)?(?:implements\s+[^{]+\s*)?\{/g
const ENTITY_DECORATOR_PATTERN = /@Entity\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)?/g
const COLUMN_PATTERN =
  /@Column\s*\(([^)]*)\)\s*(?:public\s+|private\s+|protected\s+)?(\w+)\s*:\s*(\w+)/g
const PRIMARY_COLUMN_PATTERN =
  /@PrimaryColumn\s*\(\s*(?:[^)]*)\)\s*(?:public\s+|private\s+|protected\s+)?(\w+)\s*:\s*(\w+)/g
const PRIMARY_GENERATED_PATTERN =
  /@PrimaryGeneratedColumn\s*\(\s*(?:[^)]*)\)\s*(?:public\s+|private\s+|protected\s+)?(\w+)\s*:\s*(\w+)/g
const RELATION_PATTERNS: Array<{ kind: ModelRelation['kind']; pattern: RegExp }> = [
  { kind: 'one-to-one', pattern: /@OneToOne\s*\(\s*\(\)\s*=>\s*(\w+)\s*,/g },
  { kind: 'one-to-many', pattern: /@OneToMany\s*\(\s*\(\)\s*=>\s*(\w+)\s*,/g },
  { kind: 'many-to-one', pattern: /@ManyToOne\s*\(\s*\(\)\s*=>\s*(\w+)\s*,/g },
  { kind: 'many-to-many', pattern: /@ManyToMany\s*\(\s*\(\)\s*=>\s*(\w+)\s*,/g },
]

export const typeormModelExtractor: ModelExtractorPlugin = {
  id: 'typeorm',
  languages: ['typescript'],
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
          orm: 'typeorm',
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
    // Look backwards a few chars for @Entity(...) on this class.
    const lookback = content.slice(Math.max(0, classStart - 200), classStart)
    ENTITY_DECORATOR_PATTERN.lastIndex = 0
    const entityMatch = ENTITY_DECORATOR_PATTERN.exec(lookback)
    if (!entityMatch) continue
    const tableName = entityMatch[1]
    // Find matching closing brace by simple brace counting.
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
  PRIMARY_GENERATED_PATTERN.lastIndex = 0
  while ((m = PRIMARY_GENERATED_PATTERN.exec(body)) !== null) {
    fields.push({ name: m[1], type: m[2], isRequired: true, isUnique: true, isId: true })
  }
  PRIMARY_COLUMN_PATTERN.lastIndex = 0
  while ((m = PRIMARY_COLUMN_PATTERN.exec(body)) !== null) {
    fields.push({ name: m[1], type: m[2], isRequired: true, isUnique: false, isId: true })
  }
  COLUMN_PATTERN.lastIndex = 0
  while ((m = COLUMN_PATTERN.exec(body)) !== null) {
    const options = m[1]
    fields.push({
      name: m[2],
      type: m[3],
      isRequired: !options.includes('nullable: true') && !options.includes('nullable:true'),
      isUnique: options.includes('unique: true') || options.includes('unique:true'),
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
      relations.push({ kind, target: m[1], field: '' })
    }
  }
  return relations
}

ModelExtractorRegistry.register(typeormModelExtractor)
