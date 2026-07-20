import { TaskNode } from '@/dag/types'

export class DAG {
  constructor(public nodes: Map<string, TaskNode> = new Map()) {}

  addNode(node: TaskNode): TaskNode {
    this.nodes.set(node.id, node)
    return node
  }

  addEdge(fromId: string, toId: string): void {
    const toNode = this.nodes.get(toId)
    if (toNode && !toNode.deps.includes(fromId)) {
      toNode.deps.push(fromId)
    }
  }

  getNode(id: string): TaskNode | undefined {
    return this.nodes.get(id)
  }

  getLayer(nodeId: string, memo: Map<string, number> = new Map()): number {
    if (memo.has(nodeId)) return memo.get(nodeId)!
    const node = this.nodes.get(nodeId)
    if (!node || node.deps.length === 0) {
      memo.set(nodeId, 0)
      return 0
    }
    const depth = 1 + Math.max(...node.deps.map((dep) => this.getLayer(dep, memo)))
    memo.set(nodeId, depth)
    return depth
  }

  computeLayers(): Record<number, TaskNode[]> {
    const memo = new Map<string, number>()
    for (const node of this.nodes.values()) {
      node.layer = this.getLayer(node.id, memo)
    }
    const layers: Record<number, TaskNode[]> = {}
    for (const node of this.nodes.values()) {
      if (!layers[node.layer]) layers[node.layer] = []
      layers[node.layer].push(node)
    }
    return Object.fromEntries(Object.entries(layers).sort(([a], [b]) => Number(a) - Number(b)))
  }

  validate(): string | null {
    const visited = new Set<string>()
    const path = new Set<string>()
    const stack: Array<{ nodeId: string; depIdx: number }> = []

    for (const startId of this.nodes.keys()) {
      if (visited.has(startId)) continue
      stack.push({ nodeId: startId, depIdx: -1 })

      while (stack.length > 0) {
        const frame = stack[stack.length - 1]

        if (frame.depIdx === -1) {
          path.add(frame.nodeId)
          visited.add(frame.nodeId)
          frame.depIdx = 0
        }

        const node = this.nodes.get(frame.nodeId)
        if (!node) {
          path.delete(frame.nodeId)
          stack.pop()
          continue
        }

        if (frame.depIdx < node.deps.length) {
          const dep = node.deps[frame.depIdx]
          frame.depIdx++

          if (!this.nodes.has(dep)) {
            return `Dependency '${dep}' not found (required by '${frame.nodeId}')`
          }

          if (path.has(dep)) {
            return `Cycle detected at ${dep}`
          }

          if (!visited.has(dep)) {
            stack.push({ nodeId: dep, depIdx: -1 })
          }
        } else {
          path.delete(frame.nodeId)
          stack.pop()
        }
      }
    }

    return null
  }

  summary(): string {
    const layers = this.computeLayers()
    return Object.entries(layers)
      .map(
        ([layer, nodes]) =>
          `  Layer ${layer}: ${nodes.map((n) => `${n.id}(${n.status})`).join(' | ')}`
      )
      .join('\n')
  }
}

export function createDAG(): DAG {
  return new DAG()
}

export function createTaskNode(
  id: string,
  label: string,
  fn?: () => Promise<unknown>,
  deps: string[] = []
): TaskNode {
  return {
    id,
    label,
    fn,
    deps,
    layer: 0,
    timeout: 300000,
    status: 'pending',
  }
}
