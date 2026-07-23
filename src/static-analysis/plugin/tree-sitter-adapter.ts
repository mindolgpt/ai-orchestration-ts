import type { CodeFile } from '../types'

/**
 * Optional Tree-sitter adapter.
 *
 * `tree-sitter` is declared as an optional peer dependency in package.json.
 * When the host project installs it (plus per-language grammar packages),
 * this adapter can produce AST-driven {@link CodeFile}s. When it is not
 * installed, every call resolves to `null` and the caller falls back to the
 * regex-based language plugin — so the static-analysis layer never hard-
 * depends on native bindings.
 *
 * The grammar dispatch table below is intentionally permissive: each entry
 * is a lazy dynamic import so a missing grammar package never breaks the
 * fallback path.
 */

type TreeSitterModule = {
  Parser?: unknown
  default?: unknown
}

type GrammarModule = {
  language?: unknown
  default?: unknown
}

const GRAMMAR_IMPORTS: Record<string, () => Promise<GrammarModule | null>> = {
  typescript: async () => safeImport('tree-sitter-typescript'),
  python: async () => safeImport('tree-sitter-python'),
  java: async () => safeImport('tree-sitter-java'),
  go: async () => safeImport('tree-sitter-go'),
  rust: async () => safeImport('tree-sitter-rust'),
}

let treeSitterCache: 'unloaded' | 'unavailable' | TreeSitterModule = 'unloaded'

async function loadTreeSitter(): Promise<TreeSitterModule | null> {
  if (treeSitterCache === 'unavailable') return null
  if (treeSitterCache !== 'unloaded') return treeSitterCache
  try {
    // tree-sitter is an optional peer dependency; it may not be installed.
    // @ts-expect-error — module is optional and intentionally untyped here.
    const mod = (await import('tree-sitter')) as TreeSitterModule
    treeSitterCache = mod
    return mod
  } catch {
    treeSitterCache = 'unavailable'
    return null
  }
}

async function safeImport(spec: string): Promise<GrammarModule | null> {
  try {
    return (await import(spec)) as GrammarModule
  } catch {
    return null
  }
}

/**
 * Attempt an AST-driven parse with Tree-sitter. Returns null when:
 *  - `tree-sitter` is not installed, OR
 *  - the grammar for the given language is not installed, OR
 *  - parsing fails.
 *
 * In all cases the caller must fall back to the regex language plugin.
 *
 * NOTE: full AST → CodeFile mapping is intentionally left as a stub. The
 * infrastructure (loader + grammar dispatch + fallback contract) is in
 * place so a follow-up can implement per-language walks without touching
 * the parser dispatcher.
 */
export async function parseWithTreeSitter(
  _content: string,
  _filePath: string,
  language: string
): Promise<CodeFile | null> {
  const ts = await loadTreeSitter()
  if (!ts) return null
  const grammarLoader = GRAMMAR_IMPORTS[language]
  if (!grammarLoader) return null
  const grammar = await grammarLoader()
  if (!grammar) return null
  // AST-driven extraction not yet wired; fall back to regex.
  return null
}

/** Test helper: reset the loader cache between tests. */
export function resetTreeSitterCache(): void {
  treeSitterCache = 'unloaded'
}
