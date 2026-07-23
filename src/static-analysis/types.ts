export interface CodeFile {
  path: string
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
  orm: 'prisma' | 'typeorm' | 'sequelize' | 'mongoose' | 'unknown'
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
