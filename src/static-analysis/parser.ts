import * as fs from 'fs/promises'
import * as path from 'path'
import { LanguageRegistry } from './plugin/registry'
import type { AnalysisPluginOptions, LanguagePlugin } from './plugin/types'
import type { CodeFile } from './types'
import { parseWithTreeSitter } from './plugin/tree-sitter-adapter'

/**
 * @deprecated Use {@link AnalysisPluginOptions} from `./plugin/types`. Kept
 * as an alias so external callers importing `ParserOptions` keep compiling.
 */
export type ParserOptions = AnalysisPluginOptions

const DEFAULT_EXCLUDE = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '.aio',
  'coverage',
  'target',
  'venv',
  '__pycache__',
  '.venv',
]

/**
 * Registry-based source file parser.
 *
 * Replaces the legacy TS-only parser. Files are dispatched to the language
 * plugin that owns their extension (see {@link LanguageRegistry}). Unknown
 * extensions are skipped silently — the analysis layer no longer assumes a
 * single language.
 *
 * Public API (`parseSourceFiles`, `parseFile`) is preserved so existing
 * callers (graph-builder, index) keep working.
 */
export async function parseSourceFiles(
  roots: string[],
  opts?: AnalysisPluginOptions
): Promise<Map<string, CodeFile>> {
  const exclude = new Set([...DEFAULT_EXCLUDE, ...(opts?.exclude ?? [])])
  const plugins = LanguageRegistry.filter(opts?.languages)
  if (plugins.length === 0) {
    // No language filter and nothing registered: return empty (rather than
    // throwing) so analysis degrades gracefully in minimal installs.
    return new Map()
  }
  const result = new Map<string, CodeFile>()

  for (const root of roots) {
    const absRoot = path.resolve(root)
    const files = await collectSourceFiles(absRoot, exclude, plugins)
    for (const file of files) {
      const parsed = await parseFile(file, plugins, opts?.parseMode)
      if (parsed) result.set(file, parsed)
    }
  }
  return result
}

async function collectSourceFiles(
  root: string,
  exclude: Set<string>,
  plugins: LanguagePlugin[]
): Promise<string[]> {
  const results: string[] = []
  const extSet = new Set<string>()
  for (const p of plugins) for (const ext of p.extensions) extSet.add(ext.toLowerCase())
  await collectDir(root, '', exclude, extSet, results)
  return results
}

async function collectDir(
  root: string,
  relative: string,
  exclude: Set<string>,
  extSet: Set<string>,
  results: string[]
): Promise<void> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (exclude.has(entry.name) || entry.name.startsWith('.')) continue
    const relPath = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await collectDir(root, relPath, exclude, extSet, results)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (extSet.has(ext) && !entry.name.endsWith('.d.ts')) {
        results.push(path.join(root, relPath))
      }
    }
  }
}

export async function parseFile(
  filePath: string,
  plugins?: LanguagePlugin[],
  parseMode?: 'regex' | 'tree-sitter'
): Promise<CodeFile | null> {
  const ext = path.extname(filePath).toLowerCase()
  const plugin =
    plugins?.find((p) => p.extensions.some((e) => e.toLowerCase() === ext)) ??
    LanguageRegistry.byExtension(ext)
  if (!plugin) return null
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    // Tree-sitter is optional. When requested and available we try an AST
    // parse; on any failure (missing peer dep, missing grammar, parse error)
    // we transparently fall back to the plugin's regex parser so analysis
    // never hard-fails because of a missing native binding.
    if (parseMode === 'tree-sitter') {
      const tsResult = await parseWithTreeSitter(content, filePath, plugin.id)
      if (tsResult) return tsResult
    }
    return plugin.parse(content, filePath)
  } catch {
    return null
  }
}
