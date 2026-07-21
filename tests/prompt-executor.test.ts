/// <reference types="vitest/globals" />
import { executePromptRoute, createPromptExecutorDeps } from '../src/harness/prompt-executor'
import { routePrompt, routePromptToTool } from '../src/harness/prompt-router'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

describe('prompt-executor', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-pe-'))
    process.env.AIO_PROJECT_ROOT = projectRoot
  })

  afterEach(async () => {
    delete process.env.AIO_PROJECT_ROOT
  })

  test('query_wiki routes with snippets by default', async () => {
    const deps = createPromptExecutorDeps(path.join(projectRoot, 'vault'))
    const route = routePrompt('wiki 검색 test')
    expect(route.tool).toBe('query_wiki')
    const out = await executePromptRoute(deps, {
      route,
      message: 'wiki 검색 test',
      execute: true,
      params: { query: 'test' },
    })
    expect(out.executed).toBe(true)
    const result = out.result as { response_mode?: string; pages?: unknown[] }
    expect(result.response_mode).toBe('snippets')
    expect(Array.isArray(result.pages)).toBe(true)
  })

  test('execute_dag without tasks auto-plans and runs', async () => {
    const deps = createPromptExecutorDeps(path.join(projectRoot, 'vault'))
    const route = routePromptToTool('run dag for login API', 'execute_dag')
    const out = await executePromptRoute(deps, {
      route,
      message: 'run dag for login API',
      execute: true,
    })
    expect(out.executed).toBe(true)
    const result = out.result as { status?: string; task_count?: number; nodes?: unknown[] }
    expect(result.status).toBe('completed')
    expect(result.task_count).toBeGreaterThan(0)
    expect(Array.isArray(result.nodes)).toBe(true)
  })

  test('execute_dag with suggested_tasks runs DAG', async () => {
    const deps = createPromptExecutorDeps(path.join(projectRoot, 'vault'))
    const route = routePromptToTool('execute', 'execute_dag')
    const out = await executePromptRoute(deps, {
      route,
      message: 'execute',
      execute: true,
      params: {
        plan_id: 'My Plan',
        suggested_tasks: [{ id: 'T1', label: 'Do thing' }],
      },
    })
    expect(out.executed).toBe(true)
    const result = out.result as { status?: string; nodes?: { id: string }[] }
    expect(result.status).toBe('completed')
    expect(result.nodes?.[0]?.id).toBe('T1')
  })

  test('ingest pipeline resolves README.md from project root', async () => {
    await fs.writeFile(path.join(projectRoot, 'README.md'), '# Hello\n\n'.repeat(20), 'utf-8')
    const deps = createPromptExecutorDeps(path.join(projectRoot, 'vault'))
    const route = routePromptToTool('ingest pipeline README.md', 'ingest_pipeline')
    const out = await executePromptRoute(deps, {
      route,
      message: 'ingest pipeline README.md',
      execute: true,
    })
    expect(out.executed).toBe(true)
    expect(out.error).toBeUndefined()
  })

  test('explicit tool id in message routes when keywords miss', async () => {
    const route = routePrompt('please run query_wiki for carts')
    expect(route.tool).toBe('query_wiki')
  })

  test('ingest guard blocks chat-only content', async () => {
    const deps = createPromptExecutorDeps(path.join(projectRoot, 'vault'))
    const route = routePromptToTool('ingest this chat message as wiki', 'ingest_pipeline')
    const out = await executePromptRoute(deps, {
      route,
      message: 'ingest this chat message as wiki',
      execute: true,
    })
    expect(out.executed).toBe(false)
    expect(out.error).toBe('missing_ingest_document')
    expect(out.hint).toContain('file_path')
    expect(out.fix).toContain('ingest_pipeline')
    expect(out.workflow_step).toBe('ingest')
  })

  test('dry-run includes workflow_step', async () => {
    const deps = createPromptExecutorDeps(path.join(projectRoot, 'vault'))
    const route = routePromptToTool('plan task', 'plan_task')
    const out = await executePromptRoute(deps, {
      route,
      message: 'plan task',
      execute: false,
    })
    expect(out.workflow_step).toBe('plan')
  })
})
