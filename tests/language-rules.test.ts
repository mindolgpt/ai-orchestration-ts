/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ObsidianVault } from '../src/knowledge/vault'
import { bootstrapHarness } from '../src/harness/bootstrap'
import {
  LANGUAGE_RULES,
  ALL_LANGUAGE_IDS,
  findLanguageRules,
  detectLanguagesFromStacks,
  renderLanguageRulesSection,
  LanguageRules,
} from '../src/harness/language-rules'
import { detectLanguages } from '../src/harness/detect-language'
import { runHarnessInterview, HarnessInterviewAnswers } from '../src/harness/bootstrap-interview'
import {
  projectAgentsMd,
  cursorRuleMdc,
  claudeMd,
  RuleTemplateExtras,
} from '../src/harness/templates'

// ── language-rules.ts ────────────────────────────────────────────────────

describe('language-rules', () => {
  test('ALL_LANGUAGE_IDS includes every key in LANGUAGE_RULES', () => {
    for (const id of ALL_LANGUAGE_IDS) {
      expect(LANGUAGE_RULES[id]).toBeDefined()
      expect(LANGUAGE_RULES[id].id).toBe(id)
    }
  })

  test('findLanguageRules matches by id, alias, and case-insensitive', () => {
    expect(findLanguageRules('typescript')?.label).toBe('TypeScript')
    expect(findLanguageRules('TypeScript')?.label).toBe('TypeScript')
    expect(findLanguageRules('ts')?.id).toBe('typescript')
    expect(findLanguageRules('파이썬')?.id).toBe('python')
    expect(findLanguageRules('golang')?.id).toBe('go')
    expect(findLanguageRules('nonexistent')).toBeUndefined()
  })

  test('detectLanguagesFromStacks returns languages from stack ids', () => {
    const langs = detectLanguagesFromStacks({ backend: 'spring-boot' })
    expect(langs).toContain('java')
  })

  test('detectLanguagesFromStacks includes typescript for frontend stacks', () => {
    const langs = detectLanguagesFromStacks({ frontend: 'react' })
    expect(langs).toContain('typescript')
  })

  test('detectLanguagesFromStacks merges extra keywords', () => {
    const langs = detectLanguagesFromStacks({}, ['python', 'django'])
    expect(langs).toContain('python')
  })

  test('renderLanguageRulesSection returns empty for empty languages', () => {
    expect(renderLanguageRulesSection([])).toBe('')
  })

  test('renderLanguageRulesSection includes naming, lint, testing sections', () => {
    const section = renderLanguageRulesSection(['typescript'], { strictness: 'strict' })
    expect(section).toContain('Language coding rules (auto-detected)')
    expect(section).toContain('TypeScript')
    expect(section).toContain('Naming')
    expect(section).toContain('Lint')
    expect(section).toContain('Testing')
    expect(section).toContain('strict')
    expect(section).toContain('Enforce all rules as errors')
  })

  test('renderLanguageRulesSection shows strictness labels correctly', () => {
    const section = renderLanguageRulesSection(['python'], { strictness: 'loose' })
    expect(section).toContain('Recommend these rules')
  })

  test('renderLanguageRulesSection omits absent sections', () => {
    // Add a temporary rule without docRef-like optional fields
    const section = renderLanguageRulesSection(['typescript'])
    expect(section).not.toContain('undefined')
  })
})

// ── detect-language.ts ───────────────────────────────────────────────────

describe('detect-language', () => {
  test('detectLanguages finds typescript in this repo', async () => {
    // Running from the repo root itself should detect TypeScript
    const result = await detectLanguages()
    expect(result.languages.some((d) => d.id === 'typescript')).toBe(true)
    expect(result.languages.length).toBeGreaterThanOrEqual(1)
  })

  test('detectLanguages finds go from go.mod', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-lang-go-'))
    await fs.writeFile(path.join(root, 'go.mod'), 'module test\n\ngo 1.22\n', 'utf-8')
    const result = await detectLanguages(root)
    expect(result.languages.some((d) => d.id === 'go')).toBe(true)
    expect(result.found_manifests).toContain('go.mod')
  })

  test('detectLanguages finds python from pyproject.toml', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-lang-py-'))
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[project]\nname = "test"\n', 'utf-8')
    const result = await detectLanguages(root)
    expect(result.languages.some((d) => d.id === 'python')).toBe(true)
  })

  test('detectLanguages primary is highest confidence language', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-lang-prime-'))
    await fs.writeFile(path.join(root, 'Cargo.toml'), '[package]\nname = "test"\n', 'utf-8')
    await fs.writeFile(path.join(root, 'test.py'), 'print("hello")', 'utf-8')
    const result = await detectLanguages(root)
    expect(result.primary).toBeDefined()
  })
})

// ── bootstrap-interview.ts ───────────────────────────────────────────────

describe('bootstrap-interview', () => {
  test('returns pending when no answers and nonInteractive = false', async () => {
    const result = await runHarnessInterview({ nonInteractive: false })
    expect(result.status).toBe('pending')
    expect(result.question).toBeDefined()
    expect(result.detected_languages).toBeDefined()
  })

  test('returns complete with rendered section when nonInteractive = true', async () => {
    const result = await runHarnessInterview({ nonInteractive: true })
    expect(result.status).toBe('complete')
    expect(result.rendered_rules_section).toBeTruthy()
    expect(result.answers).toBeDefined()
  })

  test('accepts explicit language answers and uses them', async () => {
    const answers: HarnessInterviewAnswers = {
      languages: ['go', 'typescript'],
      strictness: 'strict',
      formatter: 'gofmt',
      testing: 'go test',
    }
    const interview = await runHarnessInterview({
      answers,
      nonInteractive: true,
      skipScan: true,
    })
    expect(interview.status).toBe('complete')
    expect(interview.answers?.languages).toContain('go')
    expect(interview.answers?.languages).toContain('typescript')
    expect(interview.rendered_rules_section).toContain('Go')
    expect(interview.rendered_rules_section).toContain('TypeScript')
    expect(interview.rendered_rules_section).toContain('gofmt')
    expect(interview.rendered_rules_section).toContain('go test')
  })
})

// ── bootstrap + templates integration ────────────────────────────────────

describe('bootstrap language rules integration', () => {
  test('bootstrapHarness injects language_rules_section into AGENTS.md', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-lang-harness-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    const rulesSection = renderLanguageRulesSection(['typescript', 'go'], {
      strictness: 'standard',
    })

    const result = await bootstrapHarness(vault, {
      projectRoot: root,
      targets: ['cursor', 'claude'],
      force: true,
      language_rules_section: rulesSection,
      profile: { domain: 'test', description: 'test harness' },
    })

    expect(result.ok).toBe(true)

    // AGENTS.md should contain the rules section
    const agentsMd = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf-8')
    expect(agentsMd).toContain('Language coding rules')
    expect(agentsMd).toContain('TypeScript')
    expect(agentsMd).toContain('Go')

    // Claude.md should also have it
    const claudeMdFile = await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf-8')
    expect(claudeMdFile).toContain('TypeScript')

    // Cursor rule should have it
    const cursorMdc = await fs.readFile(
      path.join(root, '.cursor', 'rules', 'aio-domain-harness.mdc'),
      'utf-8'
    )
    expect(cursorMdc).toContain('Go')
  })

  test('bootstrapHarness auto-detects languages and renders rules when no section given', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-lang-auto-'))
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8')
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{}', 'utf-8')
    await fs.writeFile(path.join(root, 'index.ts'), 'const x = 1;', 'utf-8')
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    const result = await bootstrapHarness(vault, {
      projectRoot: root,
      targets: ['cursor'],
      force: true,
      profile: { domain: 'test', description: 'test' },
    })

    expect(result.ok).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('language-rules.md'))).toBe(true)

    // language-rules.md should have been persisted
    const rulesMd = await fs.readFile(path.join(root, '.aio', 'language-rules.md'), 'utf-8')
    expect(rulesMd).toContain('Language coding rules')
  })

  test('templates accept extras and include rule blocks', () => {
    const extras: RuleTemplateExtras = {
      language_rules_section: '# Language rules\n\n- Naming: test',
    }
    const profile = { name: 'x', domain: 'test', description: 'test' }

    const agentsMd = projectAgentsMd(profile, extras)
    expect(agentsMd).toContain('Language rules')
    expect(agentsMd).toContain('Naming: test')

    const cursor = cursorRuleMdc(profile, extras)
    expect(cursor).toContain('Language rules')

    const claude = claudeMd(profile, extras)
    expect(claude).toContain('Language rules')
  })

  test('templates without extras still produce clean output', () => {
    const profile = { name: 'x', domain: 'test', description: 'test' }
    const agentsMd = projectAgentsMd(profile)
    expect(agentsMd).not.toContain('Language coding rules')
    expect(agentsMd).toContain('test')
  })

  test('bootstrapHarness interview returns pending state and then complete on second call', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-interview-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    // First call with interview:true — should return pending
    const first = await bootstrapHarness(vault, {
      projectRoot: root,
      targets: ['cursor'],
      interview: true,
      profile: { domain: 'test', description: 'test' },
    })

    expect(first.ok).toBe(false)
    expect(first).toHaveProperty('interview')
    expect((first as any).interview?.status).toBe('pending')
    expect((first as any).interview?.question).toBeDefined()
    expect((first as any).files?.length).toBe(0)

    // Second call with answered languages — should complete
    const second = await bootstrapHarness(vault, {
      projectRoot: root,
      targets: ['cursor'],
      interview: true,
      force: true,
      interview_answers: {
        languages: ['typescript'],
        strictness: 'standard',
        formatter: 'prettier',
        testing: 'vitest',
        notes: '',
      },
      profile: { domain: 'test', description: 'test interview' },
    })

    expect(second.ok).toBe(true)
    expect((second as any).interview?.status).toBe('complete')
    const agentsMd = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf-8')
    expect(agentsMd).toContain('Language coding rules')
    expect(agentsMd).toContain('TypeScript')
  })
})
