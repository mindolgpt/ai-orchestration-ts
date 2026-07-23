/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { scaffoldApps } from '@/harness/scaffold/scaffold-app'

describe('scaffold-apps', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-scaffold-'))
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('creates monorepo apps and contracts', async () => {
    const r = await scaffoldApps({
      projectRoot: tmp,
      frontend: { side: 'frontend', language: 'typescript', framework: 'nextjs' },
      backend: { side: 'backend', language: 'typescript', framework: 'nestjs' },
      has_source: false,
    })
    expect(r.ok).toBe(true)
    expect(r.apps).toContain('apps/web')
    expect(r.apps).toContain('apps/api')
    expect(r.apps).toContain('packages/contracts')
    await fs.access(path.join(tmp, 'packages', 'contracts', 'src', 'index.ts'))
    await fs.access(path.join(tmp, 'apps', 'web', 'package.json'))
  })

  test('skips when has_source without force', async () => {
    const r = await scaffoldApps({ projectRoot: tmp, has_source: true })
    expect(r.skipped_reason).toMatch(/skipped/i)
    expect(r.files).toHaveLength(0)
  })
})
