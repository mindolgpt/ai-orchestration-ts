/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { buildEnrichedDesignBody, writeAcceptanceJson, buildTasksMarkdown } from '@/sdd/from-wiki'
import { createSpec } from '@/sdd/spec'
import { createDesign } from '@/sdd/design'

describe('sdd from-wiki', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-sdd-'))
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('enriched design is not empty sections only', () => {
    const spec = createSpec(
      {
        project: 'demo',
        title: 'Demo',
        productContext: 'ctx',
        requirements: [
          {
            id: 'REQ-1',
            priority: 'P0',
            description: 'Login',
            acceptanceCriteria: ['User can login'],
          },
        ],
      },
      tmp
    )
    const body = buildEnrichedDesignBody({
      projectRoot: tmp,
      spec,
      requirements: [
        {
          id: 'REQ-1',
          priority: 'P0',
          description: 'Login',
          acceptanceCriteria: ['User can login'],
        },
      ],
      asIsMarkdown: 'Existing src/',
      frontend: 'nextjs',
      backend: 'nestjs',
    })
    expect(body).toMatch(/Login/)
    expect(body).toMatch(/packages\/contracts/)
    expect(body).toMatch(/AS-IS/)
  })

  test('tasks and acceptance under .aio/sdd', async () => {
    const spec = createSpec(
      {
        project: 'demo',
        title: 'Demo',
        productContext: 'ctx',
        requirements: [
          { id: 'REQ-1', priority: 'P0', description: 'X', acceptanceCriteria: ['Y'] },
        ],
      },
      tmp
    )
    expect(spec.prdPath).toContain(path.join('.aio', 'sdd'))
    const design = createDesign(spec, tmp)
    expect(design.systemDesignPath).toContain(path.join('.aio', 'sdd'))
    const tasks = buildTasksMarkdown(design, spec, [
      { id: 'REQ-1', priority: 'P0', description: 'X' },
    ])
    expect(tasks).toMatch(/contracts/)
    const ac = await writeAcceptanceJson(tmp, spec.id, [
      { id: 'REQ-1', priority: 'P0', description: 'X', acceptanceCriteria: ['Y'] },
    ])
    expect(ac).toContain(path.join('.aio', 'sdd'))
    const parsed = JSON.parse(await fs.readFile(ac, 'utf-8'))
    expect(parsed.items.length).toBeGreaterThan(0)
  })
})
