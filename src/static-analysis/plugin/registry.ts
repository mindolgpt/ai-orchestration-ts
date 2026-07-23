import type {
  ConceptExtractorPlugin,
  LanguagePlugin,
  ModelExtractorPlugin,
  RouteExtractorPlugin,
} from './types'

/**
 * Minimal side-effect registry for static-analysis plugins.
 *
 * Plugins self-register at import time by calling the `register*` functions.
 * `src/static-analysis/index.ts` imports every plugin module once so all
 * registrations happen before any analysis runs.
 *
 * The registry is intentionally process-global and synchronous to keep
 * dispatch cheap (called per file / per analysis run).
 */

const languages = new Map<string, LanguagePlugin>()
const extensionIndex = new Map<string, LanguagePlugin>()
const routeExtractors = new Map<string, RouteExtractorPlugin>()
const modelExtractors = new Map<string, ModelExtractorPlugin>()
const conceptExtractors = new Map<string, ConceptExtractorPlugin>()

function registerLanguage(plugin: LanguagePlugin): void {
  if (languages.has(plugin.id)) {
    // Idempotent: re-import in tests / HMR should not throw.
    return
  }
  languages.set(plugin.id, plugin)
  for (const ext of plugin.extensions) {
    // First-registered wins for an extension; lets users override by importing
    // a custom plugin before the defaults.
    if (!extensionIndex.has(ext.toLowerCase())) {
      extensionIndex.set(ext.toLowerCase(), plugin)
    }
  }
}

function registerRouteExtractor(plugin: RouteExtractorPlugin): void {
  routeExtractors.set(plugin.id, plugin)
}

function registerModelExtractor(plugin: ModelExtractorPlugin): void {
  modelExtractors.set(plugin.id, plugin)
}

function registerConceptExtractor(plugin: ConceptExtractorPlugin): void {
  conceptExtractors.set(plugin.id, plugin)
}

export const LanguageRegistry = {
  register: registerLanguage,
  /** Get a language plugin by id. */
  get(id: string): LanguagePlugin | undefined {
    return languages.get(id)
  },
  /** Resolve which language plugin handles a given file extension. */
  byExtension(ext: string): LanguagePlugin | undefined {
    return extensionIndex.get(ext.toLowerCase())
  },
  /** All registered language plugins. */
  all(): LanguagePlugin[] {
    return Array.from(languages.values())
  },
  /** Plugins filtered by an optional allowlist (undefined = all). */
  filter(languageIds?: string[]): LanguagePlugin[] {
    if (!languageIds || languageIds.length === 0) return this.all()
    const set = new Set(languageIds)
    return this.all().filter((p) => set.has(p.id))
  },
  /** Reset the registry (test helper). */
  reset(): void {
    languages.clear()
    extensionIndex.clear()
  },
}

export const RouteExtractorRegistry = {
  register: registerRouteExtractor,
  all(): RouteExtractorPlugin[] {
    return Array.from(routeExtractors.values())
  },
  /** Extractors applicable to any of the given languages. */
  forLanguages(languageIds: string[]): RouteExtractorPlugin[] {
    if (!languageIds || languageIds.length === 0) return this.all()
    const set = new Set(languageIds)
    return this.all().filter((p) => p.languages.some((l) => set.has(l)))
  },
  reset(): void {
    routeExtractors.clear()
  },
}

export const ModelExtractorRegistry = {
  register: registerModelExtractor,
  all(): ModelExtractorPlugin[] {
    return Array.from(modelExtractors.values())
  },
  forLanguages(languageIds: string[]): ModelExtractorPlugin[] {
    if (!languageIds || languageIds.length === 0) return this.all()
    const set = new Set(languageIds)
    return this.all().filter((p) => p.languages.some((l) => set.has(l)))
  },
  reset(): void {
    modelExtractors.clear()
  },
}

export const ConceptExtractorRegistry = {
  register: registerConceptExtractor,
  all(): ConceptExtractorPlugin[] {
    return Array.from(conceptExtractors.values())
  },
  forLanguages(languageIds: string[]): ConceptExtractorPlugin[] {
    if (!languageIds || languageIds.length === 0) return this.all()
    const set = new Set(languageIds)
    return this.all().filter((p) => p.languages.some((l) => set.has(l)))
  },
  reset(): void {
    conceptExtractors.clear()
  },
}

/** Reset every registry. Test helper. */
export function resetAllRegistries(): void {
  LanguageRegistry.reset()
  RouteExtractorRegistry.reset()
  ModelExtractorRegistry.reset()
  ConceptExtractorRegistry.reset()
}
