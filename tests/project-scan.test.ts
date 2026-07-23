/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { scanProject } from '@/harness/project-scan'

describe('project-scan', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-scan-'))
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('greenfield has_source false', async () => {
    const scan = await scanProject(tmp)
    expect(scan.has_source).toBe(false)
    expect(scan.prefill.evidence).toEqual([])
    await fs.access(scan.scan_path)
  })

  test('detects package.json source and prefill', async () => {
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        dependencies: { next: '15.0.0', react: '19.0.0', '@nestjs/core': '10.0.0' },
        devDependencies: { typescript: '5.6.0', vitest: '2.0.0' },
      }),
      'utf-8'
    )
    await fs.mkdir(path.join(tmp, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'src', 'index.ts'), 'export {}', 'utf-8')

    const scan = await scanProject(tmp)
    expect(scan.has_source).toBe(true)
    expect(scan.prefill.frontend_tech_stack?.framework || scan.stack.frontend).toBeTruthy()
    expect(scan.brownfield_hard_rule).toMatch(/project-scan/)
  })
})
