/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { createVerifier } from '@/ralph/verifier'

describe('verifier acceptance + typecheck', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-ver-'))
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        scripts: { build: 'echo ok', lint: 'echo ok', test: 'echo ok', typecheck: 'echo ok' },
      }),
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('acceptance fails when pending items', async () => {
    const dir = path.join(tmp, '.aio', 'sdd', 'spec_x')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'acceptance.json'),
      JSON.stringify({
        items: [{ id: 'AC1', description: 'x', status: 'pending' }],
      }),
      'utf-8'
    )
    const v = createVerifier(tmp, { steps: ['acceptance'] })
    const r = await v.verifyAll()
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/AC1/)
  })

  test('acceptance passes when all pass', async () => {
    const dir = path.join(tmp, '.aio', 'sdd', 'spec_y')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'acceptance.json'),
      JSON.stringify({
        items: [{ id: 'AC1', description: 'x', status: 'pass' }],
      }),
      'utf-8'
    )
    const v = createVerifier(tmp, { steps: ['acceptance'] })
    const r = await v.verifyAll()
    expect(r.ok).toBe(true)
  })
})
