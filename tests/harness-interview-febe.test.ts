/// <reference types="vitest/globals" />
import { runHarnessInterview } from '@/harness/bootstrap-interview'

describe('harness interview FE/BE', () => {
  test('interactive asks frontend_language first', async () => {
    const r = await runHarnessInterview({
      skipScan: true,
      nonInteractive: false,
      answers: {},
    })
    expect(r.status).toBe('pending')
    expect(r.question?.id).toBe('frontend_language')
    expect(r.question?.prompt_ko).toBeTruthy()
    expect(r.question?.prompt_en).toBeTruthy()
  })

  test('order: lang → stack → architecture → rules', async () => {
    let answers = {}
    const steps: string[] = []
    for (let i = 0; i < 20; i++) {
      const r = await runHarnessInterview({
        skipScan: true,
        nonInteractive: false,
        answers,
      })
      if (r.status !== 'pending' || !r.question) break
      steps.push(String(r.question.id))
      const id = r.question.id
      const def = r.question.default || r.question.options?.[0] || ''
      answers = { ...answers, [id]: def }
      if (id === 'frontend_language') answers = { ...answers, frontend_language: 'typescript' }
      if (id === 'backend_language') answers = { ...answers, backend_language: 'typescript' }
      if (id === 'frontend_framework') answers = { ...answers, frontend_framework: 'nextjs' }
      if (id === 'backend_framework') answers = { ...answers, backend_framework: 'nestjs' }
      if (id === 'package_manager') answers = { ...answers, package_manager: 'npm' }
      if (id === 'frontend_architecture')
        answers = { ...answers, frontend_architecture: 'feature-sliced' }
      if (id === 'backend_architecture') answers = { ...answers, backend_architecture: 'clean' }
      if (id === 'architecture_notes') answers = { ...answers, architecture_notes: '' }
      if (id === 'strictness') answers = { ...answers, strictness: 'standard' }
      if (id === 'formatter') answers = { ...answers, formatter: 'auto' }
      if (id === 'testing') answers = { ...answers, testing: 'auto' }
      if (id === 'notes') answers = { ...answers, notes: '' }
    }
    expect(steps.indexOf('frontend_language')).toBeLessThan(steps.indexOf('frontend_framework'))
    expect(steps.indexOf('frontend_framework')).toBeLessThan(steps.indexOf('frontend_architecture'))
    expect(steps.indexOf('frontend_architecture')).toBeLessThan(steps.indexOf('strictness'))
  })

  test('nonInteractive completes with sections', async () => {
    const r = await runHarnessInterview({
      skipScan: true,
      nonInteractive: true,
      answers: {
        frontend_language: 'typescript',
        backend_language: 'typescript',
        frontend_framework: 'nextjs',
        backend_framework: 'nestjs',
        package_manager: 'npm',
        frontend_architecture: 'feature-sliced',
        backend_architecture: 'clean',
        architecture_notes: '',
        strictness: 'standard',
        formatter: 'auto',
        testing: 'vitest',
        notes: '',
      },
    })
    expect(r.status).toBe('complete')
    expect(r.rendered_tech_stack_section).toMatch(/Tech stack/)
    expect(r.rendered_architecture_section).toMatch(/Architecture methodologies/)
    expect(r.rendered_rules_section).toBeTruthy()
  })
})
