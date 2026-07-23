import { CodeFile, CodeGraph, RouteInfo, ModelInfo } from './types'
import { parseSourceFiles, ParserOptions } from './parser'
import {
  buildCodeGraph,
  findNodeCallers,
  findNodeCallees,
  findDependencyPath,
} from './graph-builder'
import { parseRoutes } from './route-extractor'
import { parseModels } from './model-extractor'

export interface AnalysisResult {
  files: Map<string, CodeFile>
  graph: CodeGraph
  routes: RouteInfo[]
  models: ModelInfo[]
  summary: AnalysisSummary
}

export interface AnalysisSummary {
  totalFiles: number
  totalNodes: number
  totalEdges: number
  totalRoutes: number
  totalModels: number
  analyzedAt: number
}

export async function analyzeProject(
  roots: string[],
  opts?: ParserOptions
): Promise<AnalysisResult> {
  const files = await parseSourceFiles(roots, opts)
  const graph = buildCodeGraph(files, roots)
  const routes = parseRoutes(Array.from(files.values()))
  const models = parseModels(Array.from(files.values()))

  return {
    files,
    graph,
    routes,
    models,
    summary: {
      totalFiles: files.size,
      totalNodes: graph.nodes.size,
      totalEdges: graph.edges.length,
      totalRoutes: routes.length,
      totalModels: models.length,
      analyzedAt: Date.now(),
    },
  }
}

export { buildCodeGraph, findNodeCallers, findNodeCallees, findDependencyPath }
export type { CodeFile, CodeGraph, RouteInfo, ModelInfo }
export { parseSourceFiles, parseRoutes, parseModels }
