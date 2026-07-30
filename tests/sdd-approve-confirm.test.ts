/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { SddPipeline } from '@/sdd/pipeline'

describe('SddPipeline — auto-approve (approval gates removed)', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-sdd-auto-'))
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('createSpec auto-approves and sets status=approved', async () => {
    const pipeline = new SddPipeline(tmp)
    const state = await pipeline.createSpec({
      project: 'demo',
      title: 'Demo spec',
      productContext: 'ctx',
      requirements: [
        {
          id: 'REQ-1',
          priority: 'P0',
          description: 'Login',
          acceptanceCriteria: ['User can login'],
        },
      ],
    })

    expect(state.error).toBeUndefined()
    expect(state.spec?.status).toBe('approved')
    expect(state.spec?.approvedAt).toBeGreaterThan(0)
    expect(state.spec?.approvedBy).toBe('auto')
  })

  test('createSpec writes acceptance.json for report_acceptance', async () => {
    const pipeline = new SddPipeline(tmp)
    const state = await pipeline.createSpec({
      project: 'demo',
      title: 'Demo spec',
      productContext: 'ctx',
      requirements: [
        {
          id: 'REQ-1',
          priority: 'P0',
          description: 'Login',
          acceptanceCriteria: ['User can login'],
        },
      ],
    })

    const acceptancePath = path.join(tmp, '.aio', 'sdd', state.spec!.id, 'acceptance.json')
    const raw = await fs.readFile(acceptancePath, 'utf-8')
    const data = JSON.parse(raw)
    expect(data.specId).toBe(state.spec!.id)
    expect(data.items).toHaveLength(1)
    expect(data.items[0].id).toBe('REQ-1-AC1')
    expect(data.items[0].status).toBe('pending')
  })

  test('createDesign auto-approves and computes revision fields', async () => {
    const pipeline = new SddPipeline(tmp)

    // Create spec first
    const specState = await pipeline.createSpec({
      project: 'demo',
      title: 'Demo spec',
      productContext: 'ctx',
      requirements: [
        {
          id: 'REQ-1',
          priority: 'P0',
          description: 'Login',
          acceptanceCriteria: ['User can login'],
        },
      ],
    })

    const state = await pipeline.createDesign(specState.spec!.id)
    expect(state.error).toBeUndefined()
    expect(state.design?.status).toBe('approved')
    expect(state.design?.approvedRevision).toBeTruthy()
    // approvedRevision must match designRevision
    expect(state.design?.approvedRevision).toBe(state.design?.designRevision)
    expect(state.design?.approvedAt).toBeGreaterThan(0)
    expect(state.design?.approvedBy).toBe('auto')
  })

  test('createSpec returns error for non-existent spec', async () => {
    const pipeline = new SddPipeline(tmp)
    const state = await pipeline.createDesign('nonexistent-spec')
    expect(state.error).toContain('not found')
  })

  test('generateTasks from auto-approved design succeeds', async () => {
    const pipeline = new SddPipeline(tmp)

    // Create spec
    const specState = await pipeline.createSpec({
      project: 'demo',
      title: 'Demo spec',
      productContext: 'ctx',
      requirements: [
        {
          id: 'REQ-1',
          priority: 'P0',
          description: 'Login',
          acceptanceCriteria: ['User can login'],
        },
      ],
    })

    // Create design
    const designState = await pipeline.createDesign(specState.spec!.id)

    // Generate tasks
    const tasksState = await pipeline.generateTasks(designState.design!.id)
    expect(tasksState.error).toBeUndefined()
    expect(tasksState.currentStage).toBe('tasks')
    expect(tasksState.tasks?.executionReadiness).toBe('ready')
  })

  test('getState shows correct pipeline stage progression', async () => {
    const pipeline = new SddPipeline(tmp)

    // No specs yet
    let states = await pipeline.getState()
    expect(states).toHaveLength(0)

    // Create spec
    const specState = await pipeline.createSpec({
      project: 'demo',
      title: 'Demo spec',
      productContext: 'ctx',
      requirements: [
        {
          id: 'REQ-1',
          priority: 'P0',
          description: 'Login',
          acceptanceCriteria: ['User can login'],
        },
      ],
    })

    states = await pipeline.getState()
    expect(states).toHaveLength(1)
    expect(states[0].currentStage).toBe('spec') // no design yet, stays at 'spec'

    // Create design
    await pipeline.createDesign(specState.spec!.id)
    states = await pipeline.getState()
    expect(states[0].currentStage).toBe('tasks') // auto-approved → tasks stage
  })

  test('generateTasks returns error for non-existent design', async () => {
    const pipeline = new SddPipeline(tmp)
    const state = await pipeline.generateTasks('nonexistent-design')
    expect(state.error).toContain('not found')
  })

  test('generateTasks returns error on revision mismatch', async () => {
    const pipeline = new SddPipeline(tmp)

    // Create spec
    const specState = await pipeline.createSpec({
      project: 'demo',
      title: 'Demo spec',
      productContext: 'ctx',
      requirements: [
        {
          id: 'REQ-1',
          priority: 'P0',
          description: 'Login',
          acceptanceCriteria: ['User can login'],
        },
      ],
    })

    // Create design
    const designState = await pipeline.createDesign(specState.spec!.id)

    // Manually tamper with the design revision to create mismatch
    const design = designState.design!
    design.designRevision = 'tampered-revision'
    const designsDir = path.join(tmp, '.aio', 'sdd', 'meta', 'designs')
    await fs.writeFile(path.join(designsDir, `${design.id}.json`), JSON.stringify(design, null, 2))

    const tasksState = await pipeline.generateTasks(design.id)
    expect(tasksState.error).toContain('Design revision mismatch')
  })
})
