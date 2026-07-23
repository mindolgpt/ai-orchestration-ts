import * as fs from 'fs/promises'
import * as path from 'path'
import {
  CodeFile,
  CodeImport,
  CodeExport,
  CodeClass,
  CodeFunction,
  CodeInterface,
  CodeDecorator,
  CodeMethod,
} from './types'

export interface ParserOptions {
  include?: string[]
  exclude?: string[]
}

const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', '.git', '.aio', 'coverage']
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx'])

const IMPORT_PATTERN =
  /^import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)?(?:\{[^}]*\})?\s*from\s+['"]([^'"]+)['"]/gm
const EXPORT_PATTERN =
  /^export\s+(?:(?:default|class|function|interface|type|const|let|var)\s+)?(\w+)/gm
const CLASS_PATTERN =
  /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/gm
const FUNCTION_PATTERN = /^(?:export\s+)?(?:async\s+)?function\s+(?:\*\s+)?(\w+)/gm
const INTERFACE_PATTERN = /^(?:export\s+)?interface\s+(\w+)/gm
const DECORATOR_PATTERN = /@(\w+)(?:\(([^)]*)\))?/g

export async function parseSourceFiles(
  roots: string[],
  opts?: ParserOptions
): Promise<Map<string, CodeFile>> {
  const exclude = new Set(opts?.exclude ?? DEFAULT_EXCLUDE)
  const result = new Map<string, CodeFile>()

  for (const root of roots) {
    const absRoot = path.resolve(root)
    const files = await collectSourceFiles(absRoot, exclude)
    for (const file of files) {
      const parsed = await parseFile(file)
      if (parsed) result.set(file, parsed)
    }
  }
  return result
}

async function collectSourceFiles(root: string, exclude: Set<string>): Promise<string[]> {
  const results: string[] = []
  await collectDir(root, '', exclude, results)
  return results
}

async function collectDir(
  root: string,
  relative: string,
  exclude: Set<string>,
  results: string[]
): Promise<void> {
  try {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true })
    for (const entry of entries) {
      if (exclude.has(entry.name) || entry.name.startsWith('.')) continue
      const relPath = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await collectDir(root, relPath, exclude, results)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SOURCE_EXT.has(ext) && !entry.name.endsWith('.d.ts')) {
          results.push(path.join(root, relPath))
        }
      }
    }
  } catch {
    /* skip unreadable */
  }
}

export async function parseFile(filePath: string): Promise<CodeFile | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return {
      path: filePath,
      imports: parseImports(content),
      exports: parseExports(content),
      classes: parseClasses(content),
      functions: parseFunctions(content),
      interfaces: parseInterfaces(content),
      decorators: parseDecorators(content),
    }
  } catch {
    return null
  }
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
  const METHOD_PATTERN =
    /^\s+(?:public|private|protected|static|async|\s)*(?:get\s+|set\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*(\w+))?/gm
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
