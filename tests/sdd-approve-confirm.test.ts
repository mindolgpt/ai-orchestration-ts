/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ApprovalGate } from '@/orchestrator/approval'
import { SddPipeline } from '@/sdd/pipeline'
import { createSpec } from '@/sdd/spec'
import { writeSpecFiles } from '@/sdd/spec'

describe('SddPipeline approve with confirm_code (self-complete path)', () => {
  let tmp: string
  let originalEnv: string | undefined

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-sdd-apr-'))
    // Allow MCP-style resolve to succeed without the real confirm_code, since
    // the code is only printed to server stderr and not surfaced to the test.
    originalEnv = process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE
    process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE = '1'
  })

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE
    else process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE = originalEnv
    await fs.rm(tmp, { recursive: true, force: true })
  })

  async function seedSpec(): Promise<{ pipeline: SddPipeline; specId: string }> {
    const approval = new ApprovalGate(tmp)
    await approval.load()
    const pipeline = new SddPipeline(tmp, approval)
    const input = {
      project: 'demo',
      title: 'Demo spec',
      productContext: 'ctx',
      requirements: [
        {
          id: 'REQ-1',
          priority: 'P0' as const,
          description: 'Login',
          acceptanceCriteria: ['User can login'],
        },
      ],
    }
    const spec = createSpec(input, tmp)
    await writeSpecFiles(spec, input)
    // FileSpecStore.save writes to <tmp>/.aio/sdd/meta/specs/<id>.json
    const specsDir = path.join(tmp, '.aio', 'sdd', 'meta', 'specs')
    await fs.mkdir(specsDir, { recursive: true })
    await fs.writeFile(path.join(specsDir, `${spec.id}.json`), JSON.stringify(spec, null, 2))
    return { pipeline, specId: spec.id }
  }

  test('approveSpec with confirm_code resolves immediately (no timeout)', async () => {
    const { pipeline, specId } = await seedSpec()
    const start = Date.now()
    const state = await pipeline.approveSpec(specId, 'human', {
      confirmCode: 'any-code-bypassed-by-env',
    })
    const elapsed = Date.now() - start

    expect(state.error).toBeUndefined()
    expect(state.spec?.status).toBe('approved')
    // Self-complete path must finish well under the 300s waitFor timeout.
    expect(elapsed).toBeLessThan(5000)
  })

  test('approveSpec without confirm_code still blocks (waitFor path) — abort early', async () => {
    // No env bypass here: restore env to confirm the legacy human-wait path
    // is still entered when confirm_code is omitted.
    delete process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE
    const { pipeline, specId } = await seedSpec()
    // Race the approval against a short manual timeout. Since waitFor polls
    // every 500ms and no one resolves the request, it should still be pending
    // after 1s — proving we took the waitFor branch, not the instant resolve.
    const pending = pipeline.approveSpec(specId)
    const winner = await Promise.race([
      pending.then((s) => ({ kind: 'done' as const, status: s.spec?.status })),
      new Promise() <
        { kind: 'still-pending' as const } >
        ((r) => setTimeout(() => r({ kind: 'still-pending' }), 1200)),
    ])
    expect(winner.kind).toBe('still-pending')
  })

  test('approveSpec without confirm_code times out and returns error', async () => {
    delete process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE
    const { pipeline, specId } = await seedSpec()
    // waitFor default timeout is 300s; that would slow the suite. Instead we
    // verify the branch indirectly: approveSpec with an explicit empty-string
    // confirm_code reaches resolve() and returns the confirm_code error
    // immediately (proving resolve path, not wait path).
    const state = await pipeline.approveSpec(specId, 'human', { confirmCode: '' })
    expect(state.error).toContain('confirm_code required')
    expect(state.spec?.status).toBe('draft')
  })
})
