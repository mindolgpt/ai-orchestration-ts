/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  enrichIngestParams,
  ingestPayloadReady,
  inferApprovalFromMessage,
  tryExplicitToolFromMessage,
} from '../src/harness/nl-params'

describe('nl-params', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-nl-'))
  })

  test('resolves README.md relative to project root', async () => {
    await fs.writeFile(path.join(projectRoot, 'README.md'), '# x', 'utf-8')
    const p = enrichIngestParams({}, 'ingest README.md', projectRoot)
    expect(p.file_path).toBe(path.join(projectRoot, 'README.md'))
    expect(ingestPayloadReady(p, 'ingest README.md', projectRoot)).toBe(true)
  })

  test('tryExplicitToolFromMessage finds tool ids', () => {
    expect(tryExplicitToolFromMessage('run query_wiki for cart')).toBe('query_wiki')
    expect(tryExplicitToolFromMessage('domain_context task')).toBe('domain_context')
  })

  test('inferApprovalFromMessage', () => {
    expect(inferApprovalFromMessage('승인해')).toBe(true)
    expect(inferApprovalFromMessage('reject approval')).toBe(false)
    expect(inferApprovalFromMessage('maybe')).toBeUndefined()
  })
})
