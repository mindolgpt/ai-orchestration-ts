/// <reference types="vitest/globals" />
import { listStackOptions, recommendTechStack, renderTechStackSection } from '@/harness/tech-stack'

describe('tech-stack', () => {
  test('lists typescript frontend options', () => {
    const opts = listStackOptions('frontend', 'typescript')
    expect(opts.map((o) => o.framework)).toContain('nextjs')
  })

  test('recommend merges defaults', () => {
    const stack = recommendTechStack('backend', 'typescript', { framework: 'nestjs' })
    expect(stack.framework).toBe('nestjs')
    expect(stack.orm).toBeTruthy()
  })

  test('render includes FE and BE', () => {
    const md = renderTechStackSection({
      frontend: recommendTechStack('frontend', 'typescript'),
      backend: recommendTechStack('backend', 'typescript'),
      package_manager: 'pnpm',
      monorepo_tool: 'pnpm-workspaces',
    })
    expect(md).toMatch(/Frontend/)
    expect(md).toMatch(/Backend/)
    expect(md).toMatch(/pnpm/)
  })
})
