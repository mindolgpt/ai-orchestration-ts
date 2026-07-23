import { ModelExtractorRegistry } from '../../plugin/registry'
import type { ModelExtractorPlugin } from '../../plugin/types'
import type { CodeFile, ModelField, ModelInfo, ModelRelation } from '../../types'

/**
 * Prisma schema model extractor.
 *
 * Detects `model Foo { ... }` blocks from `file.rawContent`. The legacy
 * implementation passed `content = ''` so nothing was ever extracted; this
 * plugin reads the actual schema text and populates fields + relations.
 * Fields are parsed line-by-line (robust against trailing attributes);
 * lines whose type starts with an uppercase letter are treated as relations.
 */

const PRISMA_MODEL_PATTERN = /model\s+(\w+)\s*\{([^}]+)\}/g
const PRISMA_SCALAR_TYPES = new Set([
  'String',
  'Int',
  'Float',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
  'Decimal',
  'BigInt',
  'SmallInt',
  'UUID',
  'Xml',
  'Hash',
])

export const prismaModelExtractor: ModelExtractorPlugin = {
  id: 'prisma',
  languages: ['typescript'],
  extract(files: CodeFile[]): ModelInfo[] {
    const models: ModelInfo[] = []
    for (const file of files) {
      const content = file.rawContent ?? ''
      if (!content) continue
      let modelMatch: RegExpExecArray | null
      PRISMA_MODEL_PATTERN.lastIndex = 0
      while ((modelMatch = PRISMA_MODEL_PATTERN.exec(content)) !== null) {
        const name = modelMatch[1]
        const body = modelMatch[2]
        const { fields, relations } = parsePrismaBody(body)
        models.push({
          name,
          file: file.path,
          tableName: name.toLowerCase(),
          fields,
          relations,
          orm: 'prisma',
        })
      }
    }
    return models
  },
}

function parsePrismaBody(body: string): { fields: ModelField[]; relations: ModelRelation[] } {
  const fields: ModelField[] = []
  const relations: ModelRelation[] = []
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//') || line.startsWith('@@') || line.startsWith('@')) continue
    const m = /^(\w+)\s+(\w+)/.exec(line)
    if (!m) continue
    const fieldName = m[1]
    const type = m[2]
    if (!PRISMA_SCALAR_TYPES.has(type) && /^[A-Z]/.test(type)) {
      const isArray = line.includes('[]')
      relations.push({
        kind: isArray ? 'one-to-many' : 'many-to-one',
        target: type,
        field: fieldName,
      })
      continue
    }
    fields.push({
      name: fieldName,
      type,
      isRequired: !line.includes('?'),
      isUnique: line.includes('@unique'),
      isId: line.includes('@id'),
      default: extractDefault(line),
    })
  }
  return { fields, relations }
}

function extractDefault(trailing: string): string | undefined {
  const m = /@default\(([^)]*)\)/.exec(trailing)
  return m ? m[1] : undefined
}

ModelExtractorRegistry.register(prismaModelExtractor)
