import { ModelExtractorRegistry } from '../../plugin/registry'
import type { ModelExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ModelField, ModelInfo } from '../../types'

/**
 * GORM (Go) model extractor.
 *
 * Detects structs that embed `gorm.Model` or carry `gorm:"..."` field tags,
 * and extracts fields from struct members. Table name defaults to the
 * snake_cased struct name when not specified via `TableName()`.
 */

const STRUCT_PATTERN = /^type\s+(\w+)\s+struct\s*\{([^}]*)\}/gm
const FIELD_PATTERN = /^\s*(\w+)\s+(\w+)(?:\s+`gorm:"([^"]*)"`)?/gm
const GORM_MODEL_EMBED = /\bgorm\.Model\b/

export const gormModelExtractor: ModelExtractorPlugin = {
  id: 'gorm',
  languages: ['go'],
  extract(files: CodeFile[]): ModelInfo[] {
    const models: ModelInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let m: RegExpExecArray | null
      STRUCT_PATTERN.lastIndex = 0
      while ((m = STRUCT_PATTERN.exec(content)) !== null) {
        const name = m[1]
        const body = m[2]
        if (!GORM_MODEL_EMBED.test(body) && !/gorm:"/.test(body)) continue
        models.push({
          name,
          file: file.path,
          tableName: snakeCase(name),
          fields: extractFields(body),
          relations: [],
          orm: 'gorm',
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
    const tags = m[3] || ''
    if (m[1] === 'gorm' && m[2] === 'Model') continue
    fields.push({
      name: m[1],
      type: m[2],
      isRequired: !tags.includes('default:'),
      isUnique: tags.includes('unique'),
      isId: tags.includes('primaryKey') || m[1] === 'ID',
    })
  }
  return fields
}

function snakeCase(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

ModelExtractorRegistry.register(gormModelExtractor)
