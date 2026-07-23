import type { CodeFile, CodeGraph, ConceptInfo, ModelInfo, RouteInfo } from '../types'

/**
 * Language plugin: knows how to collect and parse source files for a language.
 *
 * The static-analysis layer is language-agnostic by design. Each language is
 * contributed as a plugin and self-registers into {@link LanguageRegistry}.
 * Adding a new language = adding one plugin file + one import line in
 * `src/static-analysis/index.ts`.
 */
export interface LanguagePlugin {
  /** Stable id, e.g. 'typescript', 'python', 'java', 'go', 'rust'. */
  id: string
  /** File extensions (lowercase, with leading dot) this plugin handles. */
  extensions: string[]
  /**
   * Parse a single file's source text into a {@link CodeFile}.
   * Implementations MUST populate `rawContent` and `language` so downstream
   * extractor plugins can run framework/ORM regex passes without re-reading
   * from disk.
   */
  parse(content: string, filePath: string): CodeFile
  /**
   * Optional parser mode. 'regex' (default) is dependency-free. 'tree-sitter'
   * signals the plugin can use a Tree-sitter grammar when the optional
   * `tree-sitter` peer dependency is installed; otherwise it falls back to
   * regex.
   */
  parseMode?: 'regex' | 'tree-sitter'
}

/**
 * Route extractor plugin: detects HTTP routes for a framework.
 * Registered into {@link RouteExtractorRegistry} and dispatched per detected
 * language so frameworks never cross language boundaries by accident.
 */
export interface RouteExtractorPlugin {
  /** Stable id, e.g. 'nestjs', 'express', 'spring', 'fastapi', 'gin'. */
  id: string
  /** Languages this extractor applies to (LanguagePlugin ids). */
  languages: string[]
  /** Extract routes from parsed files. */
  extract(files: CodeFile[]): RouteInfo[]
}

/**
 * Model extractor plugin: detects data models/entities for an ORM/ODM.
 * Registered into {@link ModelExtractorRegistry}.
 */
export interface ModelExtractorPlugin {
  /** Stable id, e.g. 'prisma', 'typeorm', 'jpa', 'sqlalchemy', 'gorm'. */
  id: string
  /** Languages this extractor applies to. */
  languages: string[]
  /** Extract models from parsed files. */
  extract(files: CodeFile[]): ModelInfo[]
}

/**
 * Concept extractor plugin: detects domain concepts (use cases, events,
 * policies, aggregates, services) beyond routes/models. Registered into
 * {@link ConceptExtractorRegistry}.
 */
export interface ConceptExtractorPlugin {
  /** Stable id, e.g. 'usecase', 'events', 'policies'. */
  id: string
  /** Languages this extractor applies to. */
  languages: string[]
  /** Extract concepts from parsed files + code graph. */
  extract(files: CodeFile[], graph: CodeGraph): ConceptInfo[]
}

/**
 * Shared option bag passed to {@link parseSourceFiles} / {@link analyzeProject}.
 * Lets callers scope parsing to a subset of languages (e.g. from
 * `project-scan`'s detected languages) to avoid running irrelevant plugins.
 */
export interface AnalysisPluginOptions {
  /** Restrict to these language plugin ids. Undefined = all registered. */
  languages?: string[]
  /** Parser mode preference. 'tree-sitter' falls back to 'regex' if unavailable. */
  parseMode?: 'regex' | 'tree-sitter'
  /** Extra path globs to exclude (in addition to each plugin's defaults). */
  exclude?: string[]
  /** Path globs to include. */
  include?: string[]
}
