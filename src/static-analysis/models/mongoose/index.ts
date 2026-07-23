import { ModelExtractorRegistry } from '../../plugin/registry'
import type { ModelExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ModelInfo } from '../../types'

/**
 * Mongoose model extractor.
 *
 * Detects `const Foo = mongoose.model('Name', schema)` and the
 * `new Schema({ ... })` field declarations. The legacy implementation passed
 * `content = ''` so nothing was extracted.
 */

const MONGOOSE_MODEL_PATTERN = /const\s+(\w+)\s*=\s*mongoose\.model\s*\(\s*['"`](\w+)['"`]/g
const SCHEMA_FIELD_PATTERN =
  /^\s*(\w+)\s*:\s*\{\s*type:\s*(\w+)(?:[^}]*?required:\s*(true|false))?/gm

export const mongooseModelExtractor: ModelExtractorPlugin = {
  id: 'mongoose',
  languages: ['typescript'],
  extract(files: CodeFile[]): ModelInfo[] {
    const models: ModelInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let modelMatch: RegExpExecArray | null
      MONGOOSE_MODEL_PATTERN.lastIndex = 0
      while ((modelMatch = MONGOOSE_MODEL_PATTERN.exec(content)) !== null) {
        models.push({
          name: modelMatch[1],
          file: file.path,
          tableName: modelMatch[2],
          fields: extractSchemaFields(content, modelMatch.index),
          relations: [],
          orm: 'mongoose',
        })
      }
    }
    return models
  },
}

function extractSchemaFields(content: string, near: number): ModelInfo['fields'] {
  // Search forward up to 4KB for the Schema({ ... }) block.
  const window = content.slice(near, near + 4096)
  const schemaStart = window.indexOf('new Schema(')
  if (schemaStart < 0) return []
  const body = window.slice(schemaStart)
  const fields: ModelInfo['fields'] = []
  let m: RegExpExecArray | null
  SCHEMA_FIELD_PATTERN.lastIndex = 0
  while ((m = SCHEMA_FIELD_PATTERN.exec(body)) !== null) {
    fields.push({
      name: m[1],
      type: m[2],
      isRequired: m[3] === 'true',
      isUnique: false,
      isId: m[1] === '_id',
    })
  }
  return fields
}

ModelExtractorRegistry.register(mongooseModelExtractor)
