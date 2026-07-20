/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { createServer } from 'node:http'
import { ObsidianVault } from '../src/knowledge/vault'
import { SemanticSearch } from '../src/knowledge/search'
import { proposeWikiChange } from '../src/knowledge/wiki-mr'
import { getEventLog, resetEventLogForTests } from '../src/observability/events'
import { collectDashboardStats, startDashboardServer } from '../src/dashboard/server'

function createMockEmbedder() {
  let n = 0
  return {
    dimension: 8,
    embed: async (texts: string[]) =>
      texts.map(() => {
        n += 1
        return Array.from({ length: 8 }, (_, i) => ((n + i) % 7) / 7)
      }),
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      if (!addr || typeof addr === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      const p = addr.port
      s.close(() => resolve(p))
    })
    s.on('error', reject)
  })
}

describe('dashboard server', () => {
  beforeEach(() => {
    resetEventLogForTests()
  })

  test('loads events from JSONL after restart of EventLog singleton', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-dash-ev-'))
    const log1 = getEventLog(root)
    await log1.emit('wiki.proposal.created', { id: 'wpr_test' })
    resetEventLogForTests()
    const log2 = getEventLog(root)
    const recent = await log2.recentAsync(10)
    expect(recent.some((e) => e.type === 'wiki.proposal.created')).toBe(true)
  })

  test('HTTP stats, 404, apply/reject proposal', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-dash-http-'))
    const vaultDir = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()
    const search = new SemanticSearch(createMockEmbedder(), path.join(vaultDir, '.index'))

    const proposal = await proposeWikiChange(
      vault,
      { title: 'Dash Policy', content: '# Dash\n\nRule A\n', subdir: 'domain' },
      root
    )

    const port = await freePort()
    const { url, close } = await startDashboardServer({
      host: '127.0.0.1',
      port,
      vault,
      search,
      projectRoot: root,
    })

    try {
      const health = await fetch(`${url}/health`)
      expect(health.status).toBe(200)

      const miss = await fetch(`${url}/nope`)
      expect(miss.status).toBe(404)

      const statsRes = await fetch(`${url}/api/stats`)
      expect(statsRes.status).toBe(200)
      const stats = (await statsRes.json()) as Awaited<ReturnType<typeof collectDashboardStats>>
      expect(stats.proposals.pending).toBeGreaterThanOrEqual(1)
      expect(stats.proposals.pending_list.some((p) => p.id === proposal.id)).toBe(true)

      const html = await fetch(`${url}/`)
      expect(html.status).toBe(200)
      const body = await html.text()
      expect(body).toContain('Pending wiki proposals')
      expect(body).toContain(proposal.id)

      const apply = await fetch(`${url}/api/proposals/${proposal.id}/apply`, { method: 'POST' })
      expect(apply.status).toBe(200)

      const rejectProposal = await proposeWikiChange(
        vault,
        { title: 'Reject Dash', content: '# X\n', subdir: 'domain' },
        root
      )
      const reject = await fetch(`${url}/api/proposals/${rejectProposal.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'nope' }),
      })
      expect(reject.status).toBe(200)

      const scan = await fetch(`${url}/api/scan-inbox`, { method: 'POST' })
      expect(scan.status).toBe(200)
    } finally {
      await close()
    }
  }, 20_000)
})
