import type { LanguagePlugin } from '../../plugin/types'
import type {
  CodeClass,
  CodeDecorator,
  CodeExport,
  CodeFile,
  CodeFunction,
  CodeImport,
  CodeInterface,
} from '../../types'
import { LanguageRegistry } from '../../plugin/registry'

/**
 * Rust language plugin (regex-based).
 *
 * Detects `use` imports, `fn` functions, `struct`, `trait`, `impl`, and
 * derives (treated as decorators). No native dependency.
 */

const USE_PATTERN = /^use\s+([^;]+);/gm
const FN_PATTERN =
  /^(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/gm
const STRUCT_PATTERN = /^(?:pub\s+)?struct\s+(\w+)/gm
const TRAIT_PATTERN = /^(?:pub\s+)?trait\s+(\w+)/gm
const DERIVE_PATTERN = /#\[derive\(([^)]*)\)\]/g
const ATTRIBUTE_PATTERN = /#\[([^\]]*)\]/g

export const rustPlugin: LanguagePlugin = {
  id: 'rust',
  extensions: ['.rs'],
  parseMode: 'regex',

  parse(content: string, filePath: string): CodeFile {
    return {
      path: filePath,
      rawContent: content,
      language: 'rust',
      imports: parseRustUses(content),
      exports: parseRustExports(content),
      classes: parseRustStructs(content),
      functions: parseRustFunctions(content),
      interfaces: parseRustTraits(content),
      decorators: parseRustAttributes(content),
    }
  },
}

function parseRustUses(content: string): CodeImport[] {
  const imports: CodeImport[] = []
  let match: RegExpExecArray | null
  USE_PATTERN.lastIndex = 0
  while ((match = USE_PATTERN.exec(content)) !== null) {
    imports.push({ source: match[1].trim(), specifiers: [], isDefault: false, isType: false })
  }
  return imports
}

function parseRustExports(content: string): CodeExport[] {
  const exports: CodeExport[] = []
  let match: RegExpExecArray | null
  STRUCT_PATTERN.lastIndex = 0
  while ((match = STRUCT_PATTERN.exec(content)) !== null) {
    exports.push({ name: match[1], kind: 'class' })
  }
  TRAIT_PATTERN.lastIndex = 0
  while ((match = TRAIT_PATTERN.exec(content)) !== null) {
    exports.push({ name: match[1], kind: 'interface' })
  }
  return exports
}

function parseRustStructs(content: string): CodeClass[] {
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

function parseRustFunctions(content: string): CodeFunction[] {
  const functions: CodeFunction[] = []
  let match: RegExpExecArray | null
  FN_PATTERN.lastIndex = 0
  while ((match = FN_PATTERN.exec(content)) !== null) {
    functions.push({
      name: match[1],
      params: match[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      isAsync: match[0].includes('async'),
      isExported: match[0].startsWith('pub'),
    })
  }
  return functions
}

function parseRustTraits(content: string): CodeInterface[] {
  const interfaces: CodeInterface[] = []
  let match: RegExpExecArray | null
  TRAIT_PATTERN.lastIndex = 0
  while ((match = TRAIT_PATTERN.exec(content)) !== null) {
    interfaces.push({ name: match[1], properties: [], extends: [] })
  }
  return interfaces
}

function parseRustAttributes(content: string): CodeDecorator[] {
  const decorators: CodeDecorator[] = []
  let match: RegExpExecArray | null
  DERIVE_PATTERN.lastIndex = 0
  while ((match = DERIVE_PATTERN.exec(content)) !== null) {
    for (const d of match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      decorators.push({ name: 'derive', arguments: d })
    }
  }
  ATTRIBUTE_PATTERN.lastIndex = 0
  while ((match = ATTRIBUTE_PATTERN.exec(content)) !== null) {
    const attr = match[1].trim()
    if (attr.startsWith('derive')) continue
    const spaceIdx = attr.indexOf(' ')
    const name = spaceIdx > 0 ? attr.slice(0, spaceIdx) : attr
    const args = spaceIdx > 0 ? attr.slice(spaceIdx + 1) : undefined
    decorators.push({ name, arguments: args })
  }
  return decorators
}

LanguageRegistry.register(rustPlugin)
