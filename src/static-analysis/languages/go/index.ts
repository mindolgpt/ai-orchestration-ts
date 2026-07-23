import type { LanguagePlugin } from '../../plugin/types'
import type {
  CodeClass,
  CodeExport,
  CodeFile,
  CodeFunction,
  CodeImport,
  CodeInterface,
} from '../../types'
import { LanguageRegistry } from '../../plugin/registry'

/**
 * Go language plugin (regex-based).
 *
 * Detects package, imports (single and grouped), funcs (with receiver for
 * methods), structs and interfaces. No native dependency.
 */

const IMPORT_SINGLE_PATTERN = /^\s*import\s+"([^"]+)"/gm
const IMPORT_GROUP_PATTERN = /import\s*\(([^)]+)\)/g
const FUNC_PATTERN = /^func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s+)?(\w+)\s*\(([^)]*)\)/gm
const STRUCT_PATTERN = /^type\s+(\w+)\s+struct\s*\{/gm
const INTERFACE_PATTERN = /^type\s+(\w+)\s+interface\s*\{/gm

export const goPlugin: LanguagePlugin = {
  id: 'go',
  extensions: ['.go'],
  parseMode: 'regex',

  parse(content: string, filePath: string): CodeFile {
    return {
      path: filePath,
      rawContent: content,
      language: 'go',
      imports: parseGoImports(content),
      exports: parseGoExports(content),
      classes: parseGoStructs(content),
      functions: parseGoFunctions(content),
      interfaces: parseGoInterfaces(content),
      decorators: [],
    }
  },
}

function parseGoImports(content: string): CodeImport[] {
  const imports: CodeImport[] = []
  let match: RegExpExecArray | null
  IMPORT_SINGLE_PATTERN.lastIndex = 0
  while ((match = IMPORT_SINGLE_PATTERN.exec(content)) !== null) {
    imports.push({ source: match[1], specifiers: [], isDefault: false, isType: false })
  }
  IMPORT_GROUP_PATTERN.lastIndex = 0
  while ((match = IMPORT_GROUP_PATTERN.exec(content)) !== null) {
    for (const line of match[1].split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const m = /"([^"]+)"/.exec(trimmed)
      if (m) imports.push({ source: m[1], specifiers: [], isDefault: false, isType: false })
    }
  }
  return imports
}

function parseGoExports(content: string): CodeExport[] {
  const exports: CodeExport[] = []
  let match: RegExpExecArray | null
  FUNC_PATTERN.lastIndex = 0
  while ((match = FUNC_PATTERN.exec(content)) !== null) {
    if (/^[A-Z]/.test(match[1])) {
      exports.push({ name: match[1], kind: 'function' })
    }
  }
  STRUCT_PATTERN.lastIndex = 0
  while ((match = STRUCT_PATTERN.exec(content)) !== null) {
    if (/^[A-Z]/.test(match[1])) {
      exports.push({ name: match[1], kind: 'class' })
    }
  }
  INTERFACE_PATTERN.lastIndex = 0
  while ((match = INTERFACE_PATTERN.exec(content)) !== null) {
    if (/^[A-Z]/.test(match[1])) {
      exports.push({ name: match[1], kind: 'interface' })
    }
  }
  return exports
}

function parseGoStructs(content: string): CodeClass[] {
  const classes: CodeClass[] = []
  let match: RegExpExecArray | null
  STRUCT_PATTERN.lastIndex = 0
  while ((match = STRUCT_PATTERN.exec(content)) !== null) {
    classes.push({
      name: match[1],
      methods: [],
      properties: [],
      decorators: [],
      implements: [],
    })
  }
  return classes
}

function parseGoFunctions(content: string): CodeFunction[] {
  const functions: CodeFunction[] = []
  let match: RegExpExecArray | null
  FUNC_PATTERN.lastIndex = 0
  while ((match = FUNC_PATTERN.exec(content)) !== null) {
    functions.push({
      name: match[1],
      params: match[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      isAsync: false,
      isExported: /^[A-Z]/.test(match[1]),
    })
  }
  return functions
}

function parseGoInterfaces(content: string): CodeInterface[] {
  const interfaces: CodeInterface[] = []
  let match: RegExpExecArray | null
  INTERFACE_PATTERN.lastIndex = 0
  while ((match = INTERFACE_PATTERN.exec(content)) !== null) {
    interfaces.push({ name: match[1], properties: [], extends: [] })
  }
  return interfaces
}

LanguageRegistry.register(goPlugin)
