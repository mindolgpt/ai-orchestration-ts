import type { LanguagePlugin } from '../../plugin/types'
import type {
  CodeClass,
  CodeDecorator,
  CodeExport,
  CodeFile,
  CodeFunction,
  CodeImport,
  CodeMethod,
} from '../../types'
import { LanguageRegistry } from '../../plugin/registry'

/**
 * Python language plugin (regex-based).
 *
 * Detects imports, classes (with bases), functions (def/async def),
 * decorators and module-level exports. No native dependency; Tree-sitter
 * mode is wired in the optional adapter (todo 10) and falls back to regex.
 */

const IMPORT_PATTERN = /^(?:from\s+([^\s]+)\s+)?import\s+(.+)$/gm
const CLASS_PATTERN = /^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/gm
const FUNCTION_PATTERN = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm
const DECORATOR_PATTERN = /^@(\w+)(?:\.(\w+))?(?:\(([^)]*)\))?/gm

export const pythonPlugin: LanguagePlugin = {
  id: 'python',
  extensions: ['.py', '.pyw'],
  parseMode: 'regex',

  parse(content: string, filePath: string): CodeFile {
    return {
      path: filePath,
      rawContent: content,
      language: 'python',
      imports: parsePythonImports(content),
      exports: parsePythonExports(content),
      classes: parsePythonClasses(content),
      functions: parsePythonFunctions(content),
      interfaces: [],
      decorators: parsePythonDecorators(content),
    }
  },
}

function parsePythonImports(content: string): CodeImport[] {
  const imports: CodeImport[] = []
  let match: RegExpExecArray | null
  IMPORT_PATTERN.lastIndex = 0
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    const source = match[1] || match[2].trim().split(',')[0].trim()
    imports.push({ source, specifiers: [], isDefault: false, isType: false })
  }
  return imports
}

function parsePythonExports(content: string): CodeExport[] {
  const exports: CodeExport[] = []
  let match: RegExpExecArray | null
  CLASS_PATTERN.lastIndex = 0
  while ((match = CLASS_PATTERN.exec(content)) !== null) {
    exports.push({ name: match[1], kind: 'class' })
  }
  FUNCTION_PATTERN.lastIndex = 0
  while ((match = FUNCTION_PATTERN.exec(content)) !== null) {
    exports.push({ name: match[1], kind: 'function' })
  }
  return exports
}

function parsePythonClasses(content: string): CodeClass[] {
  const classes: CodeClass[] = []
  let match: RegExpExecArray | null
  CLASS_PATTERN.lastIndex = 0
  while ((match = CLASS_PATTERN.exec(content)) !== null) {
    const bases = match[2]
      ? match[2]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    classes.push({
      name: match[1],
      methods: parsePythonMethods(content),
      properties: [],
      decorators: [],
      extends: bases[0],
      implements: bases.slice(1),
    })
  }
  return classes
}

function parsePythonMethods(content: string): CodeMethod[] {
  const methods: CodeMethod[] = []
  let match: RegExpExecArray | null
  FUNCTION_PATTERN.lastIndex = 0
  while ((match = FUNCTION_PATTERN.exec(content)) !== null) {
    methods.push({
      name: match[1],
      params: match[2]
        .split(',')
        .map((s) => s.trim())
        .filter((p) => p && p !== 'self' && p !== 'cls'),
      visibility: 'public',
      isAsync: false,
      isStatic: false,
      decorators: [],
    })
  }
  return methods
}

function parsePythonFunctions(content: string): CodeFunction[] {
  const functions: CodeFunction[] = []
  let match: RegExpExecArray | null
  FUNCTION_PATTERN.lastIndex = 0
  while ((match = FUNCTION_PATTERN.exec(content)) !== null) {
    functions.push({
      name: match[1],
      params: match[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      isAsync: false,
      isExported: false,
    })
  }
  return functions
}

function parsePythonDecorators(content: string): CodeDecorator[] {
  const decorators: CodeDecorator[] = []
  let match: RegExpExecArray | null
  DECORATOR_PATTERN.lastIndex = 0
  while ((match = DECORATOR_PATTERN.exec(content)) !== null) {
    decorators.push({
      name: match[2] ? `${match[1]}.${match[2]}` : match[1],
      arguments: match[3],
    })
  }
  return decorators
}

LanguageRegistry.register(pythonPlugin)
