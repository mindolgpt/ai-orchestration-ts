import { CodeFile, CodeGraph, ConceptInfo, ModelInfo, RouteInfo } from './types'
import { parseSourceFiles, ParserOptions } from './parser'
import {
  buildCodeGraph,
  findNodeCallers,
  findNodeCallees,
  findDependencyPath,
} from './graph-builder'
import { parseRoutes } from './route-extractor'
import { parseModels } from './model-extractor'
import { ConceptExtractorRegistry } from './plugin/registry'
import type { AnalysisPluginOptions } from './plugin/types'

// Side-effect imports: each plugin self-registers into the appropriate
// registry on load. Adding a new language/framework/ORM = adding one import
// line here. The static-analysis layer itself stays language-agnostic.
import './languages/typescript'
import './languages/python'
import './languages/java'
import './languages/go'
import './languages/rust'
import './routes/nestjs'
import './routes/express'
import './routes/fastify'
import './routes/spring'
import './routes/fastapi'
import './routes/django'
import './routes/gin'
import './routes/echo'
import './routes/axum'
import './models/prisma'
import './models/typeorm'
import './models/mongoose'
import './models/jpa'
import './models/sqlalchemy'
import './models/gorm'
import './models/django-orm'
import './models/diesel'
import './concepts/usecase'
import './concepts/events'
import './concepts/policies'

export interface AnalysisResult {
  files: Map<string, CodeFile>
  graph: CodeGraph
  routes: RouteInfo[]
  models: ModelInfo[]
  concepts: ConceptInfo[]
  summary: AnalysisSummary
}

export interface AnalysisSummary {
  totalFiles: number
  totalNodes: number
  totalEdges: number
  totalRoutes: number
  totalModels: number
  totalConcepts: number
  /** Distinct languages detected across parsed files. */
  languages: string[]
  analyzedAt: number
}

export async function analyzeProject(
  roots: string[],
  opts?: AnalysisPluginOptions
): Promise<AnalysisResult> {
  const files = await parseSourceFiles(roots, opts)
  const graph = buildCodeGraph(files, roots)
  const fileList = Array.from(files.values())
  const routes = parseRoutes(fileList, opts)
  const models = parseModels(fileList, opts)
  const concepts = extractConcepts(fileList, graph, opts?.languages)

  const languages = new Set<string>()
  for (const f of fileList) if (f.language) languages.add(f.language)

  return {
    files,
    graph,
    routes,
    models,
    concepts,
    summary: {
      totalFiles: files.size,
      totalNodes: graph.nodes.size,
      totalEdges: graph.edges.length,
      totalRoutes: routes.length,
      totalModels: models.length,
      totalConcepts: concepts.length,
      languages: Array.from(languages).sort(),
      analyzedAt: Date.now(),
    },
  }
}

function extractConcepts(
  files: CodeFile[],
  graph: CodeGraph,
  languageFilter?: string[]
): ConceptInfo[] {
  const languageIds = collectLanguages(files, languageFilter)
  const extractors = ConceptExtractorRegistry.forLanguages(languageIds)
  const seen = new Set<string>()
  const concepts: ConceptInfo[] = []
  for (const extractor of extractors) {
    const extracted = extractor.extract(files, graph)
    for (const c of extracted) {
      const key = `${c.kind}#${c.name}@${c.file ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      concepts.push(c)
    }
  }
  return concepts
}

function collectLanguages(files: CodeFile[], filter?: string[]): string[] {
  const present = new Set<string>()
  for (const f of files) if (f.language) present.add(f.language)
  if (!filter || filter.length === 0) return Array.from(present)
  const filterSet = new Set(filter)
  return Array.from(present).filter((l) => filterSet.has(l))
}

export { buildCodeGraph, findNodeCallers, findNodeCallees, findDependencyPath }
export type { AnalysisPluginOptions }
export { parseSourceFiles, parseRoutes, parseModels }
export type { ParserOptions }
export type {
  CodeFile,
  CodeGraph,
  CodeGraphNode,
  CodeGraphEdge,
  RouteInfo,
  ModelInfo,
  ModelField,
  ModelRelation,
  ConceptInfo,
} from './types'
export {
  LanguageRegistry,
  RouteExtractorRegistry,
  ModelExtractorRegistry,
  ConceptExtractorRegistry,
} from './plugin/registry'
