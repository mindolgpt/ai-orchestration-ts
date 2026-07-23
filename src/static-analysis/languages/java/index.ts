import type { LanguagePlugin } from '../../plugin/types'
import type {
  CodeClass,
  CodeDecorator,
  CodeExport,
  CodeFile,
  CodeImport,
  CodeInterface,
  CodeMethod,
} from '../../types'
import { LanguageRegistry } from '../../plugin/registry'

/**
 * Java / Kotlin language plugin (regex-based).
 *
 * Detects package, imports, classes (extends/implements), interfaces,
 * methods, and annotations. Kotlin is covered by the same patterns for the
 * common subset (class, interface, fun). Tree-sitter mode is wired in the
 * optional adapter (todo 10) and falls back to regex.
 */

const IMPORT_PATTERN = /^import\s+(?:static\s+)?([^;]+);/gm
const CLASS_PATTERN =
  /(?:public\s+|private\s+|protected\s+|final\s+|abstract\s+|static\s+)*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/gm
const INTERFACE_PATTERN = /(?:public\s+)*interface\s+(\w+)(?:\s+extends\s+([^{]+))?/gm
const METHOD_PATTERN =
  /(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|synchronized\s+)*(?:[\w.<>]+)\s+(\w+)\s*\(([^)]*)\)/g
const ANNOTATION_PATTERN = /@(\w+)(?:\(([^)]*)\))?/g

export const javaPlugin: LanguagePlugin = {
  id: 'java',
  extensions: ['.java', '.kt', '.kts'],
  parseMode: 'regex',

  parse(content: string, filePath: string): CodeFile {
    return {
      path: filePath,
      rawContent: content,
      language: 'java',
      imports: parseJavaImports(content),
      exports: parseJavaExports(content),
      classes: parseJavaClasses(content),
      functions: [],
      interfaces: parseJavaInterfaces(content),
      decorators: parseJavaAnnotations(content),
    }
  },
}

function parseJavaImports(content: string): CodeImport[] {
  const imports: CodeImport[] = []
  let match: RegExpExecArray | null
  IMPORT_PATTERN.lastIndex = 0
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    imports.push({ source: match[1], specifiers: [], isDefault: false, isType: false })
  }
  return imports
}

function parseJavaExports(content: string): CodeExport[] {
  const exports: CodeExport[] = []
  let match: RegExpExecArray | null
  CLASS_PATTERN.lastIndex = 0
  while ((match = CLASS_PATTERN.exec(content)) !== null) {
    exports.push({ name: match[1], kind: 'class' })
  }
  INTERFACE_PATTERN.lastIndex = 0
  while ((match = INTERFACE_PATTERN.exec(content)) !== null) {
    exports.push({ name: match[1], kind: 'interface' })
  }
  return exports
}

function parseJavaClasses(content: string): CodeClass[] {
  const classes: CodeClass[] = []
  let match: RegExpExecArray | null
  CLASS_PATTERN.lastIndex = 0
  while ((match = CLASS_PATTERN.exec(content)) !== null) {
    classes.push({
      name: match[1],
      methods: parseJavaMethods(content),
      properties: [],
      decorators: [],
      extends: match[2] || undefined,
      implements: match[3] ? match[3].split(',').map((s) => s.trim()) : [],
    })
  }
  return classes
}

function parseJavaMethods(content: string): CodeMethod[] {
  const methods: CodeMethod[] = []
  let match: RegExpExecArray | null
  METHOD_PATTERN.lastIndex = 0
  while ((match = METHOD_PATTERN.exec(content)) !== null) {
    const line = match[0]
    methods.push({
      name: match[1],
      params: match[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      visibility: line.includes('private')
        ? 'private'
        : line.includes('protected')
          ? 'protected'
          : 'public',
      isAsync: false,
      isStatic: line.includes('static'),
      decorators: [],
    })
  }
  return methods
}

function parseJavaInterfaces(content: string): CodeInterface[] {
  const interfaces: CodeInterface[] = []
  let match: RegExpExecArray | null
  INTERFACE_PATTERN.lastIndex = 0
  while ((match = INTERFACE_PATTERN.exec(content)) !== null) {
    interfaces.push({
      name: match[1],
      properties: [],
      extends: match[2] ? match[2].split(',').map((s) => s.trim()) : [],
    })
  }
  return interfaces
}

function parseJavaAnnotations(content: string): CodeDecorator[] {
  const decorators: CodeDecorator[] = []
  let match: RegExpExecArray | null
  ANNOTATION_PATTERN.lastIndex = 0
  while ((match = ANNOTATION_PATTERN.exec(content)) !== null) {
    decorators.push({ name: match[1], arguments: match[2] })
  }
  return decorators
}

LanguageRegistry.register(javaPlugin)
