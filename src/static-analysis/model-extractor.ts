import { CodeFile, ModelInfo } from './types'

const PRISMA_MODEL_PATTERN = /model\s+(\w+)\s*\{([^}]+)\}/g
const PRISMA_FIELD_PATTERN = /^\s+(\w+)\s+(\w+)(?:\??)\s*(@\w+(?:\([^)]*\))?)?/gm
const MONGOOSE_MODEL_PATTERN = /const\s+(\w+)\s*=\s*mongoose\.model\s*\(\s*['"`](\w+)['"`]/g

export function parseModels(files: CodeFile[]): ModelInfo[] {
  const models: ModelInfo[] = []

  for (const file of files) {
    try {
      const content = ''
      const prismaModels = extractPrismaModels(content, file.path)
      models.push(...prismaModels)

      const typeormModels = extractTypeOrmModels('', file.path, file)
      models.push(...typeormModels)

      const mongooseModels = extractMongooseModels(content, file.path)
      models.push(...mongooseModels)
    } catch {
      // skip parse errors
    }
  }
  return models
}

function extractPrismaModels(content: string, filePath: string): ModelInfo[] {
  const models: ModelInfo[] = []
  let match: RegExpExecArray | null
  PRISMA_MODEL_PATTERN.lastIndex = 0
  while ((match = PRISMA_MODEL_PATTERN.exec(content)) !== null) {
    const modelName = match[1]
    const body = match[2]
    const fields = extractPrismaFields(body)
    const relations = extractPrismaRelations(body)
    models.push({
      name: modelName,
      file: filePath,
      tableName: modelName.toLowerCase(),
      fields,
      relations,
      orm: 'prisma',
    })
  }
  return models
}

function extractPrismaFields(body: string): ModelInfo['fields'] {
  const fields: ModelInfo['fields'] = []
  let match: RegExpExecArray | null
  PRISMA_FIELD_PATTERN.lastIndex = 0
  while ((match = PRISMA_FIELD_PATTERN.exec(body)) !== null) {
    fields.push({
      name: match[1],
      type: match[2],
      isRequired: !body.slice(body.indexOf(match[1]) - 1, body.indexOf(match[1])).includes('?'),
      isUnique: (match[3] || '').includes('@unique'),
      isId: (match[3] || '').includes('@id'),
    })
  }
  return fields
}

function extractPrismaRelations(body: string): ModelInfo['relations'] {
  const relations: ModelInfo['relations'] = []
  const lines = body.split('\n')
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2 && /^[A-Z]/.test(parts[1])) {
      const field = parts[0]
      const target = parts[1].replace('?', '')
      const kind = line.includes('[]') ? 'one-to-many' : 'many-to-one'
      relations.push({ kind, target, field })
    }
  }
  return relations
}

function extractTypeOrmModels(_content: string, filePath: string, file: CodeFile): ModelInfo[] {
  const models: ModelInfo[] = []
  for (const cls of file.classes) {
    const entityDecorator = cls.decorators.find((d) => d === 'Entity')
    if (entityDecorator) {
      models.push({
        name: cls.name,
        file: filePath,
        fields: [],
        relations: [],
        orm: 'typeorm',
      })
    }
  }
  return models
}

function extractMongooseModels(content: string, filePath: string): ModelInfo[] {
  const models: ModelInfo[] = []
  let match: RegExpExecArray | null
  MONGOOSE_MODEL_PATTERN.lastIndex = 0
  while ((match = MONGOOSE_MODEL_PATTERN.exec(content)) !== null) {
    models.push({
      name: match[1],
      file: filePath,
      tableName: match[2],
      fields: [],
      relations: [],
      orm: 'mongoose',
    })
  }
  return models
}
