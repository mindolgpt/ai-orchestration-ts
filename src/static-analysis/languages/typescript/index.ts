import type { LanguagePlugin } from '../../plugin/types'
import type {
  CodeClass,
  CodeDecorator,
  CodeExport,
  CodeFile,
  CodeFunction,
  CodeImport,
  CodeInterface,
  CodeMethod,
} from '../../types'
import { LanguageRegistry } from '../../plugin/registry'

/**
 * TypeScript / JavaScript language plugin (regex-based).
 *
 * Migrated from the legacy `parser.ts`. Keeps the same regex patterns so
 * existing behaviour is preserved, but now populates `rawContent` and
 * `language` on every {@link CodeFile} so downstream extractor plugins
 * (routes/models/concepts) can run framework/ORM regex passes without
 * re-reading files from disk.
 *
 * Tree-sitter mode is stubbed here and wired in the optional tree-sitter
 * adapter (see todo 10); when unavailable we transparently fall back to
 * regex parsing.
 */

const IMPORT_PATTERN =
  /^import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)?(?:\{[^}]*\})?\s*from\s+['"]([^'"]+)['"]/gm
const EXPORT_PATTERN =
  /^export\s+(?:(?:default|class|function|interface|type|const|let|var)\s+)?(\w+)/gm
const CLASS_PATTERN =
  /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/gm
const FUNCTION_PATTERN = /^(?:export\s+)?(?:async\s+)?function\s+(?:\*\s*)?(\w+)/gm
const INTERFACE_PATTERN = /^(?:export\s+)?interface\s+(\w+)/gm
const DECORATOR_PATTERN = /@(\w+)(?:\(([^)]*)\))?/g
const METHOD_PATTERN =
  /^\s+(?:public|private|protected|static|async|\s)*(?:get\s+|set\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*(\w+))?/gm

export const typescriptPlugin: LanguagePlugin = {
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  parseMode: 'regex',

  parse(content: string, filePath: string): CodeFile {
    return {
      path: filePath,
      rawContent: content,
      language: 'typescript',
      imports: parseImports(content),
      exports: parseExports(content),
      classes: parseClasses(content),
      functions: parseFunctions(content),
      interfaces: parseInterfaces(content),
      decorators: parseDecorators(content),
    }
  },
}

export function parseImports(content: string): CodeImport[] {
  const imports: CodeImport[] = []
  let match: RegExpExecArray | null
  IMPORT_PATTERN.lastIndex = 0
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      isDefault: false,
      isType: false,
    })
  }
  return imports
}

export function parseExports(content: string): CodeExport[] {
  const exports: CodeExport[] = []
  let match: RegExpExecArray | null
  EXPORT_PATTERN.lastIndex = 0
  while ((match = EXPORT_PATTERN.exec(content)) !== null) {
    const kw = match[0]
    const name = match[1]
    let kind: CodeExport['kind'] = 'variable'
    if (kw.includes('class')) kind = 'class'
    else if (kw.includes('function')) kind = 'function'
    else if (kw.includes('interface')) kind = 'interface'
    else if (kw.includes('type')) kind = 'type'
    else if (kw.includes('default')) kind = 'default'
    exports.push({ name, kind })
  }
  return exports
}

export function parseClasses(content: string): CodeClass[] {
  const classes: CodeClass[] = []
  let match: RegExpExecArray | null
  CLASS_PATTERN.lastIndex = 0
  while ((match = CLASS_PATTERN.exec(content)) !== null) {
    classes.push({
      name: match[1],
      methods: parseMethods(content),
      properties: [],
      decorators: [],
      extends: match[2] || undefined,
      implements: match[3] ? match[3].split(',').map((s) => s.trim()) : [],
    })
  }
  return classes
}

export function parseMethods(content: string): CodeMethod[] {
  const methods: CodeMethod[] = []
  METHOD_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = METHOD_PATTERN.exec(content)) !== null) {
    const line = match[0]
    methods.push({
      name: match[1],
      params: match[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      returnType: match[3],
      visibility: line.includes('private')
        ? 'private'
        : line.includes('protected')
          ? 'protected'
          : 'public',
      isAsync: line.includes('async'),
      isStatic: line.includes('static'),
      decorators: [],
    })
  }
  return methods
}

export function parseFunctions(content: string): CodeFunction[] {
  const functions: CodeFunction[] = []
  let match: RegExpExecArray | null
  FUNCTION_PATTERN.lastIndex = 0
  while ((match = FUNCTION_PATTERN.exec(content)) !== null) {
    functions.push({
      name: match[1],
      params: [],
      isAsync: match[0].includes('async'),
      isExported: match[0].startsWith('export'),
    })
  }
  return functions
}

export function parseInterfaces(content: string): CodeInterface[] {
  const interfaces: CodeInterface[] = []
  let match: RegExpExecArray | null
  INTERFACE_PATTERN.lastIndex = 0
  while ((match = INTERFACE_PATTERN.exec(content)) !== null) {
    interfaces.push({
      name: match[1],
      properties: [],
      extends: [],
    })
  }
  return interfaces
}

export function parseDecorators(content: string): CodeDecorator[] {
  const decorators: CodeDecorator[] = []
  let match: RegExpExecArray | null
  DECORATOR_PATTERN.lastIndex = 0
  while ((match = DECORATOR_PATTERN.exec(content)) !== null) {
    decorators.push({
      name: match[1],
      arguments: match[2],
    })
  }
  return decorators
}

LanguageRegistry.register(typescriptPlugin)
