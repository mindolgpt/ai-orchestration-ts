/// <reference types="vitest/globals" />
import * as path from 'path'
import { resolveContainedRelPaths, isPathInsideRoot } from '../src/security/path-containment'
import { buildChildEnv } from '../src/security/child-env'
import { resolveSseAuthRequirement, isLoopbackHost } from '../src/security/sse-auth'
import { assertTrustedLocalEmbeddingModel } from '../src/security/embedding-model'
import {
  timingSafeEqualString,
  isLoopbackAddress,
  assertHttpAuthorized,
} from '../src/security/http-auth'
import { resolveDashboardAuthRequirement } from '../src/security/dashboard-auth'
import { registerVault } from '../src/knowledge/vault-registry'
import * as fs from 'fs/promises'
import * as os from 'os'

describe('path containment', () => {
  test('allows relative paths under root', () => {
    const root = path.resolve('/tmp/proj')
    expect(resolveContainedRelPaths(root, ['src', './lib'])).toEqual(['src', 'lib'])
    expect(isPathInsideRoot(root, path.join(root, 'a.ts'))).toBe(true)
  })

  test('rejects path escape', () => {
    const root = path.resolve('/tmp/proj')
    expect(() => resolveContainedRelPaths(root, ['../secret'])).toThrow(/escapes project root/)
  })
})

describe('child env allowlist', () => {
  const prevPass = process.env.AIO_CHILD_ENV_PASSTHROUGH
  const prevExtra = process.env.AIO_CHILD_ENV_EXTRA

  afterEach(() => {
    if (prevPass === undefined) delete process.env.AIO_CHILD_ENV_PASSTHROUGH
    else process.env.AIO_CHILD_ENV_PASSTHROUGH = prevPass
    if (prevExtra === undefined) delete process.env.AIO_CHILD_ENV_EXTRA
    else process.env.AIO_CHILD_ENV_EXTRA = prevExtra
    delete process.env.AWS_SECRET_ACCESS_KEY
    delete process.env.OPENAI_API_KEY
  })

  test('passes AI keys and strips unrelated secrets by default', () => {
    delete process.env.AIO_CHILD_ENV_PASSTHROUGH
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret'
    const env = buildChildEnv({ AIO_SESSION_ID: 'sess_1' })
    expect(env.AIO_SESSION_ID).toBe('sess_1')
    expect(env.OPENAI_API_KEY).toBe('sk-test')
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.PATH || env.Path).toBeTruthy()
  })

  test('passthrough restores full env', () => {
    process.env.AIO_CHILD_ENV_PASSTHROUGH = '1'
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret'
    const env = buildChildEnv({ AIO_SESSION_ID: 'sess_1' })
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('aws-secret')
  })
})

describe('SSE bind auth requirement', () => {
  const prevToken = process.env.AIO_SSE_TOKEN
  const prevInsecure = process.env.AIO_SSE_ALLOW_INSECURE

  afterEach(() => {
    if (prevToken === undefined) delete process.env.AIO_SSE_TOKEN
    else process.env.AIO_SSE_TOKEN = prevToken
    if (prevInsecure === undefined) delete process.env.AIO_SSE_ALLOW_INSECURE
    else process.env.AIO_SSE_ALLOW_INSECURE = prevInsecure
  })

  test('loopback does not require auth by default', () => {
    delete process.env.AIO_SSE_TOKEN
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(resolveSseAuthRequirement('127.0.0.1')).toEqual({ token: null, requireAuth: false })
  })

  test('non-loopback without token throws', () => {
    delete process.env.AIO_SSE_TOKEN
    delete process.env.AIO_SSE_ALLOW_INSECURE
    expect(() => resolveSseAuthRequirement('0.0.0.0')).toThrow(/AIO_SSE_TOKEN/)
  })

  test('non-loopback with token requires auth', () => {
    process.env.AIO_SSE_TOKEN = 'secret'
    expect(resolveSseAuthRequirement('0.0.0.0')).toEqual({ token: 'secret', requireAuth: true })
  })
})

describe('embedding model allowlist', () => {
  const prev = process.env.AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL

  afterEach(() => {
    if (prev === undefined) delete process.env.AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL
    else process.env.AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL = prev
  })

  test('allows Xenova models', () => {
    expect(() => assertTrustedLocalEmbeddingModel('Xenova/multilingual-e5-small')).not.toThrow()
  })

  test('rejects untrusted models', () => {
    delete process.env.AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL
    expect(() => assertTrustedLocalEmbeddingModel('evil/malware-model')).toThrow(
      /trusted allowlist/
    )
  })
})

describe('http auth helpers', () => {
  test('timingSafeEqualString matches equal strings only', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true)
    expect(timingSafeEqualString('abc', 'abd')).toBe(false)
    expect(timingSafeEqualString('abc', 'ab')).toBe(false)
  })

  test('isLoopbackAddress detects loopback peers', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('10.0.0.1')).toBe(false)
  })

  test('assertHttpAuthorized rejects wrong token', () => {
    const req = {
      headers: { authorization: 'Bearer wrong' },
    } as import('node:http').IncomingMessage
    const url = new URL('http://127.0.0.1/')
    expect(() => assertHttpAuthorized(req, url, 'secret', true)).toThrow(/Unauthorized/)
  })
})

describe('dashboard bind auth requirement', () => {
  const prevToken = process.env.AIO_DASHBOARD_TOKEN
  const prevInsecure = process.env.AIO_DASHBOARD_ALLOW_INSECURE

  afterEach(() => {
    if (prevToken === undefined) delete process.env.AIO_DASHBOARD_TOKEN
    else process.env.AIO_DASHBOARD_TOKEN = prevToken
    if (prevInsecure === undefined) delete process.env.AIO_DASHBOARD_ALLOW_INSECURE
    else process.env.AIO_DASHBOARD_ALLOW_INSECURE = prevInsecure
  })

  test('non-loopback without token throws', () => {
    delete process.env.AIO_DASHBOARD_TOKEN
    delete process.env.AIO_DASHBOARD_ALLOW_INSECURE
    expect(() => resolveDashboardAuthRequirement('0.0.0.0')).toThrow(/AIO_DASHBOARD_TOKEN/)
  })
})

describe('register_vault path validation', () => {
  test('rejects absolute path outside project root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-reg-'))
    delete process.env.AIO_ALLOW_EXTERNAL_VAULT_PATH
    await expect(
      registerVault({ name: 'ext', path: path.join(os.tmpdir(), 'outside-vault') }, root)
    ).rejects.toThrow(/project root/)
  })
})
