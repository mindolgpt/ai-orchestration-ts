import { ModelExtractorRegistry } from '../../plugin/registry'
import type { ModelExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ModelField, ModelInfo, ModelRelation } from '../../types'

/**
 * SQLAlchemy (Python) model extractor.
 *
 * Detects classes with `__tablename__ = "..."` and `Column(...)` field
 * declarations, plus `relationship("Model")` associations.
 */

const TABLENAME_PATTERN = /__tablename__\s*=\s*['"`]([^'"`]+)['"`]/
const CLASS_PATTERN = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/gm
const COLUMN_PATTERN =
  /(\w+)\s*=\s*Column\s*\(\s*(\w+)(?:[^)]*?primary_key\s*=\s*(True|False))?(?:[^)]*?nullable\s*=\s*(True|False))?(?:[^)]*?unique\s*=\s*(True|False))?/g
const RELATIONSHIP_PATTERN = /(\w+)\s*=\s*relationship\s*\(\s*['"`]([^'"`]+)['"`]/g

export const sqlalchemyModelExtractor: ModelExtractorPlugin = {
  id: 'sqlalchemy',
  languages: ['python'],
  extract(files: CodeFile[]): ModelInfo[] {
    const models: ModelInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      const classSpans = findClassSpans(content)
      for (const span of classSpans) {
        const body = content.slice(span.start, span.end)
        const tablename = TABLENAME_PATTERN.exec(body)
        if (!tablename) continue
        models.push({
          name: span.className,
          file: file.path,
          tableName: tablename[1],
          fields: extractFields(body),
          relations: extractRelations(body),
          orm: 'sqlalchemy',
        })
      }
    }
    return models
  },
}

interface ClassSpan {
  className: string
  start: number
  end: number
}

function findClassSpans(content: string): ClassSpan[] {
  const spans: ClassSpan[] = []
  let m: RegExpExecArray | null
  CLASS_PATTERN.lastIndex = 0
  while ((m = CLASS_PATTERN.exec(content)) !== null) {
    const className = m[1]
    const classStart = m.index
    const bodyStart = classStart + m[0].length
    const end = findClassEnd(content, bodyStart)
    spans.push({ className, start: classStart, end })
  }
  return spans
}

function findClassEnd(content: string, from: number): number {
  // Python class body ends at next top-level `class `/`def `/EOF.
  const rest = content.slice(from)
  const nextDef = /^(?:class\s+\w+|def\s+\w+|@)/m.exec(rest)
  if (nextDef) return from + nextDef.index
  return content.length
}

function extractFields(body: string): ModelField[] {
  const fields: ModelField[] = []
  let m: RegExpExecArray | null
  COLUMN_PATTERN.lastIndex = 0
  while ((m = COLUMN_PATTERN.exec(body)) !== null) {
    fields.push({
      name: m[1],
      type: m[2],
      isRequired: m[4] !== 'True',
      isUnique: m[5] === 'True',
      isId: m[3] === 'True',
    })
  }
  return fields
}

function extractRelations(body: string): ModelRelation[] {
  const relations: ModelRelation[] = []
  let m: RegExpExecArray | null
  RELATIONSHIP_PATTERN.lastIndex = 0
  while ((m = RELATIONSHIP_PATTERN.exec(body)) !== null) {
    relations.push({ kind: 'many-to-one', target: m[2], field: m[1] })
  }
  return relations
}

ModelExtractorRegistry.register(sqlalchemyModelExtractor)
