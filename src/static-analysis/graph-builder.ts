import { CodeFile, CodeGraph, CodeGraphNode, CodeGraphEdge } from './types'
import { parseRoutes } from './route-extractor'
import { parseModels } from './model-extractor'

export function buildCodeGraph(files: Map<string, CodeFile>, _roots?: string[]): CodeGraph {
  const nodes = new Map<string, CodeGraphNode>()
  const edges: CodeGraphEdge[] = []
  const sourceCommits = new Map<string, string>()

  for (const [filePath, file] of files) {
    const moduleNode: CodeGraphNode = {
      id: `module:${filePath}`,
      kind: 'module',
      name: filePath,
      filePath,
      exports: file.exports.map((e) => e.name),
      imports: file.imports.map((i) => i.source),
      metadata: {},
    }
    nodes.set(moduleNode.id, moduleNode)

    for (const exp of file.exports) {
      const exportId = `export:${filePath}#${exp.name}`
      nodes.set(exportId, {
        id: exportId,
        kind: exp.kind === 'class' ? 'class' : exp.kind === 'function' ? 'function' : 'type',
        name: exp.name,
        filePath,
        exports: [],
        imports: [],
        metadata: {},
      })
      edges.push({ source: moduleNode.id, target: exportId, kind: 'exports' })
    }

    for (const imp of file.imports) {
      const resolved = resolveImportPath(filePath, imp.source)
      if (resolved) {
        const targetId = `module:${resolved}`
        if (nodes.has(targetId)) {
          edges.push({ source: moduleNode.id, target: targetId, kind: 'imports' })
        }
      }
    }

    for (const cls of file.classes) {
      if (cls.extends) {
        edges.push({
          source: `export:${filePath}#${cls.name}`,
          target: `class:${cls.extends}`,
          kind: 'extends',
        })
      }
      for (const iface of cls.implements) {
        edges.push({
          source: `export:${filePath}#${cls.name}`,
          target: `interface:${iface}`,
          kind: 'implements',
        })
      }
    }
  }

  const routes = parseRoutes(Array.from(files.values()))
  for (const route of routes) {
    const routeId = `route:${route.method} ${route.path}`
    nodes.set(routeId, {
      id: routeId,
      kind: 'route',
      name: `${route.method} ${route.path}`,
      filePath: route.handlerFile,
      exports: [],
      imports: [],
      metadata: {
        method: route.method,
        path: route.path,
        handler: route.handler,
        controller: route.controller,
      },
    })
    const handlerNode = nodes.get(`module:${route.handlerFile}`)
    if (handlerNode) {
      edges.push({ source: routeId, target: handlerNode.id, kind: 'route-handler' })
    }
  }

  const models = parseModels(Array.from(files.values()))
  for (const model of models) {
    const modelId = `model:${model.name}`
    nodes.set(modelId, {
      id: modelId,
      kind: 'model',
      name: model.name,
      filePath: model.file,
      exports: [],
      imports: [],
      metadata: { tableName: model.tableName, orm: model.orm, fields: model.fields.length },
    })
    for (const rel of model.relations) {
      const targetModel = `model:${rel.target}`
      if (nodes.has(targetModel)) {
        edges.push({ source: modelId, target: targetModel, kind: 'model-relation' })
      }
    }
  }

  return { nodes, edges, analyzedAt: Date.now(), sourceCommits }
}

function resolveImportPath(fromFile: string, importSpec: string): string | null {
  if (!importSpec.startsWith('.')) return null
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf('/'))
  const resolved = pathJoin(fromDir, importSpec)
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']
  for (const ext of extensions) {
    const candidate = resolved + ext
    if (candidate.endsWith(ext)) return candidate
  }
  return resolved
}

function pathJoin(...parts: string[]): string {
  return parts
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/\.\//g, '/')
    .replace(/\/\.$/, '')
}

export function findNodeCallers(graph: CodeGraph, nodeId: string): CodeGraphEdge[] {
  return graph.edges.filter((e) => e.target === nodeId)
}

export function findNodeCallees(graph: CodeGraph, nodeId: string): CodeGraphEdge[] {
  return graph.edges.filter((e) => e.source === nodeId)
}

export function findDependencyPath(
  graph: CodeGraph,
  from: string,
  to: string,
  maxDepth = 10
): string[][] {
  const paths: string[][] = []
  const visited = new Set<string>()

  function dfs(current: string, path: string[]) {
    if (path.length > maxDepth) return
    if (current === to) {
      paths.push([...path])
      return
    }
    if (visited.has(current)) return
    visited.add(current)

    for (const edge of graph.edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        dfs(edge.target, [...path, edge.target])
      }
    }
    visited.delete(current)
  }

  dfs(from, [from])
  return paths
}
