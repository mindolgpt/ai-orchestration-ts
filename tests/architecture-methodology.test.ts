/// <reference types="vitest/globals" />
import {
  recommendMethodology,
  renderArchitectureMethodologySection,
  listMethodologies,
} from '@/harness/architecture-methodology'

describe('architecture-methodology', () => {
  test('recommends feature-sliced for FE typescript', () => {
    const m = recommendMethodology('frontend', 'typescript', 'nextjs')
    expect(m.id).toBe('feature-sliced')
    expect(m.folder_layout.length).toBeGreaterThan(0)
  })

  test('recommends clean for nestjs', () => {
    const m = recommendMethodology('backend', 'typescript', 'nestjs')
    expect(m.id).toBe('clean')
  })

  test('render has layers before empty', () => {
    const md = renderArchitectureMethodologySection({
      frontend: 'feature-sliced',
      backend: 'clean',
    })
    expect(md).toMatch(/### Layers/)
    expect(md).toMatch(/Folder layout/)
  })

  test('list filters by side', () => {
    const fe = listMethodologies('frontend', 'typescript', 'react')
    expect(fe.every((m) => m.side === 'frontend' || m.side === 'both')).toBe(true)
  })
})
