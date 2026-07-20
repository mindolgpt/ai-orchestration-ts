/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { saveCheckpoint, loadCheckpoint, clearCheckpoint } from '../src/dag/checkpoint'
import { createDAG, createTaskNode, DAGExecutor } from '../src/dag'
import { ApprovalGate, looksDangerous } from '../src/orchestrator/approval'

describe('DAG checkpoint + resume', () => {
  test('save and load checkpoint', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-cp-'))
    const file = await saveCheckpoint(
      {
        planId: 'planA',
        results: { T1: { ok: true } },
        nodeStatuses: { T1: 'success', T2: 'pending' },
        updatedAt: Date.now(),
      },
      root
    )
    expect(file).toContain('planA')
    const loaded = await loadCheckpoint('planA', root)
    expect(loaded?.results.T1).toEqual({ ok: true })
    await clearCheckpoint('planA', root)
    expect(await loadCheckpoint('planA', root)).toBeNull()
  })

  test('executor skips seeded success nodes', async () => {
    const dag = createDAG()
    dag.addNode(createTaskNode('A', 'A'))
    dag.addNode(createTaskNode('B', 'B', undefined, ['A']))
    const ran: string[] = []
    const executor = new DAGExecutor(dag, 2)
    const result = await executor.execute(
      async (node) => {
        ran.push(node.id)
        return `out-${node.id}`
      },
      { seedResults: { A: 'cached-A' } }
    )
    expect(ran).toEqual(['B'])
    expect(result.results.get('A')).toBe('cached-A')
    expect(result.results.get('B')).toBe('out-B')
  })
})

describe('ApprovalGate', () => {
  test('looksDangerous detects push/publish', () => {
    expect(looksDangerous('please git push origin main')).toBe(true)
    expect(looksDangerous('npm publish')).toBe(true)
    expect(looksDangerous('add a unit test')).toBe(false)
  })

  test('request and resolve', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-apr-'))
    const gate = new ApprovalGate(root)
    await gate.load()
    const req = await gate.request('deploy', 'prod', 'critical')
    expect(req.status).toBe('pending')
    const resolved = await gate.resolve(req.id, true, 'tester')
    expect(resolved).toMatchObject({ status: 'approved', resolver: 'tester' })
  })
})
