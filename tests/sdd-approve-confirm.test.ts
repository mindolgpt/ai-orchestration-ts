/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ApprovalGate } from '@/orchestrator/approval'
import { SddPipeline } from '@/sdd/pipeline'
import { createSpec } from '@/sdd/spec'
import { writeSpecFiles } from '@/sdd/spec'

async function seedSpec(tmp: string): Promise<{ specId: string; specRevision: string }> {
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
  const specsDir = path.join(tmp, '.aio', 'sdd', 'meta', 'specs')
  await fs.mkdir(specsDir, { recursive: true })
  await fs.writeFile(path.join(specsDir, `${spec.id}.json`), JSON.stringify(spec, null, 2))
  return { specId: spec.id, specRevision: spec.revision }
}

describe('SddPipeline approve — confirm_code self-complete path', () => {
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

  test('approveSpec with confirm_code resolves immediately (no timeout)', async () => {
    const approval = new ApprovalGate(tmp)
    await approval.load()
    const pipeline = new SddPipeline(tmp, approval)
    const { specId } = await seedSpec(tmp)

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

  test('approveSpec with empty-string confirm_code reaches resolve() and returns error', async () => {
    delete process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE
    const approval = new ApprovalGate(tmp)
    await approval.load()
    const pipeline = new SddPipeline(tmp, approval)
    const { specId } = await seedSpec(tmp)

    // confirm_code is "" (defined, not undefined) -> resolve() path is taken.
    // Without env bypass, empty code fails confirmCodeOk() and resolve()
    // returns the descriptive 'confirm_code required' error — proving we
    // called resolve() rather than waiting on waitFor().
    const state = await pipeline.approveSpec(specId, 'human', { confirmCode: '' })
    expect(state.error).toContain('confirm_code required')
    expect(state.spec?.status).toBe('draft')
  })
})

describe('SddPipeline approve — autoApprove (AIO_SDD_AUTO_APPROVE)', () => {
  let tmp: string
  let originalEnv: string | undefined

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-sdd-auto-'))
    originalEnv = process.env.AIO_SDD_AUTO_APPROVE
    delete process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE
  })

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.AIO_SDD_AUTO_APPROVE
    else process.env.AIO_SDD_AUTO_APPROVE = originalEnv
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('autoApprove=true self-completes without confirm_code (deps opt-in)', async () => {
    const approval = new ApprovalGate(tmp)
    await approval.load()
    const pipeline = new SddPipeline(tmp, approval, { autoApprove: true })
    const { specId } = await seedSpec(tmp)

    const start = Date.now()
    const state = await pipeline.approveSpec(specId)
    const elapsed = Date.now() - start

    expect(state.error).toBeUndefined()
    expect(state.spec?.status).toBe('approved')
    expect(elapsed).toBeLessThan(5000)
  })

  test('autoApprove via env var (AIO_SDD_AUTO_APPROVE=1) self-completes', async () => {
    process.env.AIO_SDD_AUTO_APPROVE = '1'
    const approval = new ApprovalGate(tmp)
    await approval.load()
    const pipeline = new SddPipeline(tmp, approval)
    const { specId } = await seedSpec(tmp)

    const state = await pipeline.approveSpec(specId)
    expect(state.error).toBeUndefined()
    expect(state.spec?.status).toBe('approved')
  })
})

describe('SddPipeline approveDesign — auto-evidence path (AIO_SDD_AUTO_APPROVE)', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-sdd-design-'))
    delete process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('approveDesign with autoApprove synthesizes evidence and approves (no human wait)', async () => {
    // autoApprove on -> both spec approval and design approval self-complete.
    const approval = new ApprovalGate(tmp)
    await approval.load()
    const pipeline = new SddPipeline(tmp, approval, { autoApprove: true })

    // Seed + approve spec first (autoApprove gate).
    const { specId } = await seedSpec(tmp)
    const specState = await pipeline.approveSpec(specId)
    expect(specState.spec?.status).toBe('approved')

    // Seed a design linked to the approved spec.
    const designDir = path.join(tmp, '.aio', 'sdd', `design-test1`)
    await fs.mkdir(designDir, { recursive: true })
    const designPath = path.join(designDir, 'system_design.md')
    await fs.writeFile(designPath, '# System Design\n\nBody\n', 'utf-8')
    const designId = 'design-test1'
    const design = {
      id: designId,
      specId,
      status: 'draft' as const,
      designRevision: '',
      productFingerprint: '',
      evidenceFingerprint: '',
      systemDesignPath: designPath,
      createdAt: Date.now(),
    }
    const designsDir = path.join(tmp, '.aio', 'sdd', 'meta', 'designs')
    await fs.mkdir(designsDir, { recursive: true })
    await fs.writeFile(path.join(designsDir, `${designId}.json`), JSON.stringify(design, null, 2))

    // approveDesign with empty evidence -> autoApprove synthesizes evidence.
    const state = await pipeline.approveDesign(designId, [], undefined, 'human')
    expect(state.error).toBeUndefined()
    expect(state.design?.status).toBe('approved')
    expect(state.design?.approvedRevision).toBeTruthy()
  })

  test('approveDesign without autoApprove + no evidence returns NEEDS_WORK (self review)', async () => {
    // No autoApprove, no evidence -> selfReview returns NEEDS_WORK, gate blocks.
    const approval = new ApprovalGate(tmp)
    await approval.load()
    const pipeline = new SddPipeline(tmp, approval, { autoApprove: false })

    const { specId } = await seedSpec(tmp)
    // Approve spec via explicit confirm_code path so we can get to design.
    delete process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE
    // Can't easily approve without code -> skip: this test focuses on the
    // design gate behavior, which only runs after spec approval. So we
    // directly verify the self-review error using an approved spec by
    // toggling autoApprove on just for the spec step.
    const pipeline2 = new SddPipeline(tmp, approval, { autoApprove: true })
    await pipeline2.approveSpec(specId)

    const designDir = path.join(tmp, '.aio', 'sdd', `design-test2`)
    await fs.mkdir(designDir, { recursive: true })
    const designPath = path.join(designDir, 'system_design.md')
    await fs.writeFile(designPath, '# System Design\n', 'utf-8')
    const designId = 'design-test2'
    const designObj = {
      id: designId,
      specId,
      status: 'draft' as const,
      designRevision: '',
      productFingerprint: '',
      evidenceFingerprint: '',
      systemDesignPath: designPath,
      createdAt: Date.now(),
    }
    const designsDir = path.join(tmp, '.aio', 'sdd', 'meta', 'designs')
    await fs.mkdir(designsDir, { recursive: true })
    await fs.writeFile(
      path.join(designsDir, `${designId}.json`),
      JSON.stringify(designObj, null, 2)
    )

    const state = await pipeline.approveDesign(designId, [], undefined, 'human')
    expect(state.error).toContain('Self review')
    expect(state.design?.status).toBe('draft')
  })
})
