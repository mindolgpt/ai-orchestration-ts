import { ModelExtractorRegistry } from '../../plugin/registry'
import type { ModelExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ModelField, ModelInfo } from '../../types'

/**
 * Diesel (Rust) model extractor.
 *
 * Detects structs annotated with `#[derive(Queryable)]` / `#[derive(Insertable)]`
 * and `table!` macro definitions. Field extraction is best-effort from the
 * struct body.
 */

const QUERYABLE_PATTERN = /#\[derive\([^\]]*Queryable[^\]]*\)\]/g
const INSERTABLE_PATTERN = /#\[derive\([^\]]*Insertable[^\]]*\)\]/g
const STRUCT_PATTERN = /(?:pub\s+)?struct\s+(\w+)\s*\{([^}]*)\}/g
const FIELD_PATTERN = /^\s*(?:pub\s+)?(\w+)\s*:\s*([\w<>]+)/gm
const TABLE_MACRO_PATTERN = /table!\s*\{\s*(\w+)\s*(?:\(|\{)/g

export const dieselModelExtractor: ModelExtractorPlugin = {
  id: 'diesel',
  languages: ['rust'],
  extract(files: CodeFile[]): ModelInfo[] {
    const models: ModelInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      // Structs with Queryable/Insertable derive.
      let structMatch: RegExpExecArray | null
      STRUCT_PATTERN.lastIndex = 0
      while ((structMatch = STRUCT_PATTERN.exec(content)) !== null) {
        const structStart = structMatch.index
        const lookback = content.slice(Math.max(0, structStart - 200), structStart)
        QUERYABLE_PATTERN.lastIndex = 0
        INSERTABLE_PATTERN.lastIndex = 0
        const isModel = QUERYABLE_PATTERN.exec(lookback) || INSERTABLE_PATTERN.exec(lookback)
        if (!isModel) continue
        const body = structMatch[2]
        models.push({
          name: structMatch[1],
          file: file.path,
          tableName: structMatch[1].toLowerCase(),
          fields: extractFields(body),
          relations: [],
          orm: 'diesel',
        })
      }
      // table! macro definitions (table name only).
      let tableMatch: RegExpExecArray | null
      TABLE_MACRO_PATTERN.lastIndex = 0
      while ((tableMatch = TABLE_MACRO_PATTERN.exec(content)) !== null) {
        const name = tableMatch[1]
        if (models.some((m) => m.name.toLowerCase() === name.toLowerCase())) continue
        models.push({
          name,
          file: file.path,
          tableName: name,
          fields: [],
          relations: [],
          orm: 'diesel',
        })
      }
    }
    return models
  },
}

function extractFields(body: string): ModelField[] {
  const fields: ModelField[] = []
  let m: RegExpExecArray | null
  FIELD_PATTERN.lastIndex = 0
  while ((m = FIELD_PATTERN.exec(body)) !== null) {
    fields.push({
      name: m[1],
      type: m[2],
      isRequired: !m[2].includes('Option<'),
      isUnique: false,
      isId: m[1].toLowerCase() === 'id',
    })
  }
  return fields
}

ModelExtractorRegistry.register(dieselModelExtractor)
