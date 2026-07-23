/// <reference types="vitest/globals" />
import { describe, expect, it } from 'vitest'
import '@/static-analysis' // side-effect: registers all plugins
import {
  LanguageRegistry,
  ModelExtractorRegistry,
  RouteExtractorRegistry,
  ConceptExtractorRegistry,
} from '@/static-analysis/plugin/registry'

describe('static-analysis registry', () => {
  it('registers the built-in language plugins', () => {
    const ids = LanguageRegistry.all().map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['typescript', 'python', 'java', 'go', 'rust']))
  })

  it('resolves language plugins by extension', () => {
    expect(LanguageRegistry.byExtension('.ts')?.id).toBe('typescript')
    expect(LanguageRegistry.byExtension('.py')?.id).toBe('python')
    expect(LanguageRegistry.byExtension('.java')?.id).toBe('java')
    expect(LanguageRegistry.byExtension('.go')?.id).toBe('go')
    expect(LanguageRegistry.byExtension('.rs')?.id).toBe('rust')
    expect(LanguageRegistry.byExtension('.unknown')).toBeUndefined()
  })

  it('filters language plugins by allowlist', () => {
    const filtered = LanguageRegistry.filter(['python'])
    expect(filtered.map((p) => p.id)).toEqual(['python'])
    expect(LanguageRegistry.filter(undefined).length).toBeGreaterThanOrEqual(5)
  })

  it('registers route extractors for multiple languages', () => {
    const ids = RouteExtractorRegistry.all().map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'nestjs',
        'express',
        'fastify',
        'spring',
        'fastapi',
        'django',
        'gin',
        'echo',
        'axum',
      ])
    )
    expect(RouteExtractorRegistry.forLanguages(['python']).map((p) => p.id)).toEqual(
      expect.arrayContaining(['fastapi', 'django'])
    )
    expect(RouteExtractorRegistry.forLanguages(['rust']).map((p) => p.id)).toEqual(['axum'])
  })

  it('registers model extractors for multiple ORMs', () => {
    const ids = ModelExtractorRegistry.all().map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'prisma',
        'typeorm',
        'mongoose',
        'jpa',
        'sqlalchemy',
        'gorm',
        'django-orm',
        'diesel',
      ])
    )
    expect(ModelExtractorRegistry.forLanguages(['java']).map((p) => p.id)).toEqual(['jpa'])
    expect(ModelExtractorRegistry.forLanguages(['go']).map((p) => p.id)).toEqual(['gorm'])
  })

  it('registers concept extractors', () => {
    const ids = ConceptExtractorRegistry.all().map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['usecase', 'events', 'policies']))
    expect(
      ConceptExtractorRegistry.forLanguages(['typescript', 'python']).length
    ).toBeGreaterThanOrEqual(3)
  })
})
