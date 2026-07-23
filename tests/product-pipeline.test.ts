/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { bootstrapProduct } from '@/harness/product-pipeline'

describe('product-pipeline', () => {
  let tmp: string
  const prevRoot = process.env.AIO_PROJECT_ROOT

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-pp-'))
    process.env.AIO_PROJECT_ROOT = tmp
  })

  afterEach(async () => {
    if (prevRoot === undefined) delete process.env.AIO_PROJECT_ROOT
    else process.env.AIO_PROJECT_ROOT = prevRoot
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('blocks on sdd approval by default', async () => {
    const r = await bootstrapProduct({
      projectRoot: tmp,
      domain: 'shop',
      description: 'demo shop',
      phases: ['wiki', 'sdd'],
      resume: false,
      reset: true,
      format: 'summary',
    })
    expect(r.status).toBe('blocked')
    expect(r.blocked_reason).toBe('awaiting_sdd_approval')
    await fs.access(path.join(tmp, '.aio', 'product-pipeline.json'))
  }, 60_000)

  test('auto_approve continues through interview nonInteractive', async () => {
    const r = await bootstrapProduct({
      projectRoot: tmp,
      domain: 'shop',
      description: 'demo',
      phases: ['wiki', 'sdd', 'interview', 'harness', 'contracts', 'scaffold', 'ci'],
      auto_approve_spec: true,
      non_interactive: true,
      resume: false,
      reset: true,
      force_scaffold: true,
      format: 'summary',
    })
    expect(['complete', 'partial', 'pending']).toContain(r.status as string)
    const st = JSON.parse(
      await fs.readFile(path.join(tmp, '.aio', 'product-pipeline.json'), 'utf-8')
    )
    expect(st.phase_status.wiki).toBe('done')
    expect(st.phase_status.sdd).toBe('done')
    expect(st.phase_status.interview).toBe('done')
  }, 120_000)
})
