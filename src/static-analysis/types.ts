export interface CodeFile {
  path: string
  /**
   * Original source text of the file. Preserved by the parser so that
   * extractor plugins (routes, models, concepts) can run framework/ORM
   * specific regex passes without re-reading from disk. May be empty for
   * synthetic files.
   */
  rawContent?: string
  /** Language plugin id that produced this CodeFile (e.g. 'typescript'). */
  language?: string
  imports: CodeImport[]
  exports: CodeExport[]
  classes: CodeClass[]
  functions: CodeFunction[]
  interfaces: CodeInterface[]
  decorators: CodeDecorator[]
}

export interface CodeImport {
  source: string
  specifiers: string[]
  isDefault: boolean
  isType: boolean
}

export interface CodeExport {
  name: string
  kind: 'class' | 'function' | 'interface' | 'type' | 'variable' | 'default'
  typeInfo?: string
}

export interface CodeClass {
  name: string
  methods: CodeMethod[]
  properties: CodeProperty[]
  decorators: string[]
  extends?: string
  implements: string[]
}

export interface CodeMethod {
  name: string
  params: string[]
  returnType?: string
  visibility: 'public' | 'private' | 'protected'
  isAsync: boolean
  isStatic: boolean
  decorators: string[]
}

export interface CodeProperty {
  name: string
  type?: string
  visibility: 'public' | 'private' | 'protected'
  isStatic: boolean
  isReadonly: boolean
}

export interface CodeFunction {
  name: string
  params: string[]
  returnType?: string
  isAsync: boolean
  isExported: boolean
}

export interface CodeInterface {
  name: string
  properties: { name: string; type: string; optional: boolean }[]
  extends: string[]
}

export interface CodeDecorator {
  name: string
  arguments?: string
}

export interface CodeGraphNode {
  id: string
  kind: 'module' | 'class' | 'function' | 'interface' | 'type' | 'route' | 'model'
  name: string
  filePath: string
  exports: string[]
  imports: string[]
  metadata: Record<string, unknown>
}

export interface CodeGraphEdge {
  source: string
  target: string
  kind:
    | 'imports'
    | 'exports'
    | 'extends'
    | 'implements'
    | 'calls'
    | 'references'
    | 'route-handler'
    | 'model-relation'
}

export interface CodeGraph {
  nodes: Map<string, CodeGraphNode>
  edges: CodeGraphEdge[]
  analyzedAt: number
  sourceCommits: Map<string, string>
}

export interface RouteInfo {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  path: string
  handler: string
  handlerFile: string
  middlewares: string[]
  controller?: string
}

export interface ModelInfo {
  name: string
  file: string
  tableName?: string
  fields: ModelField[]
  relations: ModelRelation[]
  /**
   * ORM/ODM that produced this model. Open-ended string so plugins can register
   * new ORMs (jpa, sqlalchemy, gorm, django-orm, diesel, ...) without changing
   * the type. Legacy values ('prisma' | 'typeorm' | 'sequelize' | 'mongoose'
   * | 'unknown') remain valid.
   */
  orm: string
}

export interface ModelField {
  name: string
  type: string
  isRequired: boolean
  isUnique: boolean
  isId: boolean
  default?: string
  relation?: string
}

export interface ModelRelation {
  kind: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'
  target: string
  through?: string
  field: string
}

/**
 * A domain concept extracted from source. ConceptExtractor plugins produce
 * these to enrich the SOT wiki beyond routes/models (use cases, events,
 * policies, aggregates, services, etc.).
 */
export interface ConceptInfo {
  /** Plugin kind: 'usecase' | 'event' | 'policy' | 'aggregate' | 'service' ... */
  kind: string
  name: string
  file?: string
  language?: string
  /** Short human-readable summary shown in the SOT wiki. */
  summary?: string
  /** Related symbols (class/function names) for cross-linking. */
  related?: string[]
  metadata?: Record<string, unknown>
}
