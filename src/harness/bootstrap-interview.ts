/**
 * Harness bootstrap interview: language → tech stack → architecture → coding rules.
 * Bilingual (KO/EN). Prefills from project-scan when source exists.
 */
import { DetectedLanguage } from '@/harness/detect-language'
import {
  ALL_LANGUAGE_IDS,
  LANGUAGE_RULES,
  LanguageId,
  renderLanguageRulesSection,
} from '@/harness/language-rules'
import {
  recommendTechStack,
  renderTechStackSection,
  TechStackChoice,
  PackageManager,
  MonorepoTool,
  listStackOptions,
} from '@/harness/tech-stack'
import {
  MethodologyId,
  listMethodologies,
  recommendMethodology,
  renderArchitectureMethodologySection,
} from '@/harness/architecture-methodology'
import { scanProject, InterviewPrefill, ProjectScanResult } from '@/harness/project-scan'

export type RuleStrictness = 'strict' | 'standard' | 'loose'
export type FormatterChoice = 'auto' | 'none' | (string & {})
export type TestingChoice = 'auto' | 'none' | (string & {})

export interface BilingualText {
  ko: string
  en: string
}

export interface HarnessInterviewAnswers {
  languages?: LanguageId[]
  frontend_language?: LanguageId
  backend_language?: LanguageId
  frontend_framework?: string
  backend_framework?: string
  frontend_tech_stack?: Partial<TechStackChoice>
  backend_tech_stack?: Partial<TechStackChoice>
  frontend_architecture?: MethodologyId
  backend_architecture?: MethodologyId
  architecture_notes?: string
  package_manager?: PackageManager
  monorepo_tool?: MonorepoTool
  strictness?: RuleStrictness
  formatter?: FormatterChoice
  testing?: TestingChoice
  targets?: string[]
  skip_formatter?: boolean
  skip_testing?: boolean
  notes?: string
  /** Legacy aliases */
  frontend?: string
  backend?: string
}

export type InterviewQuestionId =
  | keyof HarnessInterviewAnswers
  | 'confirm_languages'
  | 'frontend_language'
  | 'backend_language'
  | 'frontend_framework'
  | 'backend_framework'
  | 'package_manager'
  | 'frontend_architecture'
  | 'backend_architecture'
  | 'architecture_notes'

export interface HarnessInterviewQuestion {
  id: InterviewQuestionId
  prompt: string
  prompt_ko: string
  prompt_en: string
  why: string
  why_ko: string
  why_en: string
  options?: string[]
  default?: string
  detected?: string
  evidence?: string[]
  confidence?: number
}

export interface HarnessInterviewResult {
  status: 'pending' | 'complete' | 'error'
  question?: HarnessInterviewQuestion
  detected_languages?: DetectedLanguage[]
  answers?: HarnessInterviewAnswers
  project_scan?: ProjectScanResult
  prefill?: InterviewPrefill
  rendered_rules_section?: string
  rendered_tech_stack_section?: string
  rendered_architecture_section?: string
  rule_section_lines?: number
  hint?: string
  hint_ko?: string
  hint_en?: string
}

function q(
  partial: Omit<HarnessInterviewQuestion, 'prompt' | 'why'> & {
    prompt_ko: string
    prompt_en: string
    why_ko: string
    why_en: string
  }
): HarnessInterviewQuestion {
  return {
    ...partial,
    prompt: `${partial.prompt_ko}\n${partial.prompt_en}`,
    why: `${partial.why_ko} / ${partial.why_en}`,
  }
}

const BE_LANGS = new Set<LanguageId>([
  'go',
  'java',
  'kotlin',
  'python',
  'rust',
  'csharp',
  'php',
  'ruby',
  'elixir',
  'scala',
])

function normalizeAnswers(raw?: HarnessInterviewAnswers): HarnessInterviewAnswers {
  const a = { ...(raw || {}) }
  if (a.frontend && !a.frontend_framework) a.frontend_framework = a.frontend
  if (a.backend && !a.backend_framework) a.backend_framework = a.backend
  if (a.frontend_tech_stack?.framework && !a.frontend_framework) {
    a.frontend_framework = a.frontend_tech_stack.framework
  }
  if (a.backend_tech_stack?.framework && !a.backend_framework) {
    a.backend_framework = a.backend_tech_stack.framework
  }

  // Legacy: answers.languages[] without FE/BE split
  if (a.languages?.length && !a.frontend_language && !a.backend_language) {
    const langs = a.languages.filter((id) => ALL_LANGUAGE_IDS.includes(id))
    const be = langs.find((l) => BE_LANGS.has(l))
    const fe =
      langs.find((l) => !BE_LANGS.has(l)) ||
      (langs.includes('typescript') ? 'typescript' : langs[0])
    a.frontend_language = fe
    a.backend_language = be || langs.find((l) => l !== fe) || fe
    if (!a.frontend_framework) {
      a.frontend_framework =
        listStackOptions('frontend', a.frontend_language)[0]?.framework || 'react'
    }
    if (!a.backend_framework) {
      a.backend_framework =
        listStackOptions('backend', a.backend_language)[0]?.framework || 'express'
    }
    if (!a.package_manager) a.package_manager = 'npm'
    if (!a.frontend_architecture) {
      a.frontend_architecture = recommendMethodology(
        'frontend',
        a.frontend_language,
        a.frontend_framework
      ).id
    }
    if (!a.backend_architecture) {
      a.backend_architecture = recommendMethodology(
        'backend',
        a.backend_language,
        a.backend_framework
      ).id
    }
    if (a.architecture_notes === undefined) a.architecture_notes = ''
  }

  return a
}

function applyPrefill(
  answers: HarnessInterviewAnswers,
  prefill: InterviewPrefill
): HarnessInterviewAnswers {
  const a = { ...answers }
  if (!a.frontend_language && prefill.frontend_language)
    a.frontend_language = prefill.frontend_language
  if (!a.backend_language && prefill.backend_language) a.backend_language = prefill.backend_language
  if (!a.languages?.length && prefill.languages?.length) a.languages = prefill.languages
  if (!a.frontend_framework && prefill.frontend_tech_stack?.framework) {
    a.frontend_framework = prefill.frontend_tech_stack.framework
    a.frontend_tech_stack = { ...prefill.frontend_tech_stack, ...a.frontend_tech_stack }
  }
  if (!a.backend_framework && prefill.backend_tech_stack?.framework) {
    a.backend_framework = prefill.backend_tech_stack.framework
    a.backend_tech_stack = { ...prefill.backend_tech_stack, ...a.backend_tech_stack }
  }
  if (!a.frontend_architecture && prefill.frontend_architecture) {
    a.frontend_architecture = prefill.frontend_architecture
  }
  if (!a.backend_architecture && prefill.backend_architecture) {
    a.backend_architecture = prefill.backend_architecture
  }
  if (!a.package_manager && prefill.package_manager) a.package_manager = prefill.package_manager
  if (!a.monorepo_tool && prefill.monorepo_tool) a.monorepo_tool = prefill.monorepo_tool
  if (!a.formatter && prefill.formatter) a.formatter = prefill.formatter
  if (!a.testing && prefill.testing) a.testing = prefill.testing
  return a
}

function evidenceFor(prefill: InterviewPrefill | undefined, field: string): string[] {
  return (prefill?.evidence || [])
    .filter((e) => e.field === field || e.field.startsWith(field))
    .map((e) => `${e.value}: ${e.evidence}`)
}

function missingQuestion(
  answers: HarnessInterviewAnswers,
  prefill?: InterviewPrefill
): HarnessInterviewQuestion | null {
  const a = answers

  if (!a.frontend_language) {
    const det = prefill?.frontend_language
    return q({
      id: 'frontend_language',
      prompt_ko: det
        ? `프론트엔드 언어 확인: 감지=${det}. 확인하거나 다른 언어를 지정하세요.`
        : '프론트엔드 언어를 선택하세요.',
      prompt_en: det
        ? `Confirm frontend language (detected: ${det}) or override.`
        : 'Choose the frontend language.',
      why_ko: '언어별 기술스택·코딩규칙의 기준이 됩니다.',
      why_en: 'Drives tech-stack options and coding rules.',
      options: ['typescript', 'javascript', 'dart'],
      default: det || 'typescript',
      detected: det,
      evidence: evidenceFor(prefill, 'language'),
    })
  }

  if (!a.backend_language) {
    const det = prefill?.backend_language
    return q({
      id: 'backend_language',
      prompt_ko: det
        ? `백엔드 언어 확인: 감지=${det}. 확인하거나 다른 언어를 지정하세요.`
        : '백엔드 언어를 선택하세요.',
      prompt_en: det
        ? `Confirm backend language (detected: ${det}) or override.`
        : 'Choose the backend language.',
      why_ko: '백엔드 스택·아키텍처 방법론 선택에 사용됩니다.',
      why_en: 'Used for backend stack and architecture methodology.',
      options: ['typescript', 'java', 'kotlin', 'python', 'go', 'rust', 'csharp'],
      default: det || 'typescript',
      detected: det,
      evidence: evidenceFor(prefill, 'language'),
    })
  }

  const frontendLanguage = a.frontend_language
  const backendLanguage = a.backend_language
  if (!frontendLanguage || !backendLanguage) return null

  if (!a.frontend_framework) {
    const opts = listStackOptions('frontend', frontendLanguage).map((o) => o.framework)
    const det = prefill?.frontend_tech_stack?.framework
    return q({
      id: 'frontend_framework',
      prompt_ko: det
        ? `프론트 기술스택(프레임워크) 확인: 감지=${det}`
        : '프론트엔드 프레임워크를 선택하세요.',
      prompt_en: det
        ? `Confirm frontend framework (detected: ${det})`
        : 'Choose the frontend framework.',
      why_ko: '코딩규칙보다 먼저 기술스택을 확정합니다.',
      why_en: 'Tech stack is fixed before coding rules.',
      options: opts.length ? opts : ['nextjs', 'react', 'vue'],
      default: det || opts[0] || 'nextjs',
      detected: det,
      evidence: evidenceFor(prefill, 'frontend_framework'),
    })
  }

  if (!a.backend_framework) {
    const opts = listStackOptions('backend', backendLanguage).map((o) => o.framework)
    const det = prefill?.backend_tech_stack?.framework
    return q({
      id: 'backend_framework',
      prompt_ko: det
        ? `백엔드 기술스택(프레임워크) 확인: 감지=${det}`
        : '백엔드 프레임워크를 선택하세요.',
      prompt_en: det
        ? `Confirm backend framework (detected: ${det})`
        : 'Choose the backend framework.',
      why_ko: '스캐폴드·방법론 추천의 입력입니다.',
      why_en: 'Inputs scaffolding and methodology recommendations.',
      options: opts.length ? opts : ['nestjs', 'express', 'spring-boot'],
      default: det || opts[0] || 'nestjs',
      detected: det,
      evidence: evidenceFor(prefill, 'backend_framework'),
    })
  }

  if (!a.package_manager) {
    const det = prefill?.package_manager
    return q({
      id: 'package_manager',
      prompt_ko: `패키지 매니저 / 모노레포 도구를 선택하세요 (예: npm,npm-workspaces). 감지=${det || 'npm'}`,
      prompt_en: `Package manager (npm|pnpm|yarn). Detected=${det || 'npm'}`,
      why_ko: '워크스페이스·CI 스크립트에 반영됩니다.',
      why_en: 'Affects workspaces and CI scripts.',
      options: ['npm', 'pnpm', 'yarn'],
      default: det || 'npm',
      detected: det,
      evidence: evidenceFor(prefill, 'package_manager'),
    })
  }

  if (!a.frontend_architecture) {
    const opts = listMethodologies('frontend', frontendLanguage, a.frontend_framework).map(
      (m) => m.id
    )
    const det = prefill?.frontend_architecture
    const rec = recommendMethodology('frontend', frontendLanguage, a.frontend_framework).id
    return q({
      id: 'frontend_architecture',
      prompt_ko: `프론트 아키텍처 방법론을 선택하세요. 추천=${det || rec}`,
      prompt_en: `Choose frontend architecture methodology. Recommended=${det || rec}`,
      why_ko: '코딩규칙의 structure/folder_layout보다 먼저 확정합니다.',
      why_en: 'Must be set before coding-rule structure sections.',
      options: opts.length ? opts : ['feature-sliced', 'clean', 'pages-modules'],
      default: det || rec,
      detected: det,
    })
  }

  if (!a.backend_architecture) {
    const opts = listMethodologies('backend', backendLanguage, a.backend_framework).map((m) => m.id)
    const det = prefill?.backend_architecture
    const rec = recommendMethodology('backend', backendLanguage, a.backend_framework).id
    return q({
      id: 'backend_architecture',
      prompt_ko: `백엔드 아키텍처 방법론을 선택하세요. 추천=${det || rec}`,
      prompt_en: `Choose backend architecture methodology. Recommended=${det || rec}`,
      why_ko: '도메인 경계·의존 방향의 기준입니다.',
      why_en: 'Defines dependency direction and module boundaries.',
      options: opts.length ? opts : ['clean', 'hexagonal', 'layered'],
      default: det || rec,
      detected: det,
    })
  }

  if (a.architecture_notes === undefined) {
    return q({
      id: 'architecture_notes',
      prompt_ko: '아키텍처 보완 메모가 있으면 입력하세요 (없으면 빈 값).',
      prompt_en: 'Optional architecture notes (blank to skip).',
      why_ko: 'BC 경계·배포 형태 등을 기록합니다.',
      why_en: 'Records BC boundaries / deployment notes.',
      default: '',
    })
  }

  if (!a.strictness) {
    return q({
      id: 'strictness',
      prompt_ko: '코딩규칙 엄격도를 선택하세요.',
      prompt_en: 'How strict should coding rules be in CI?',
      why_ko: '기술스택·방법론 확정 후에만 설정합니다.',
      why_en: 'Only after tech stack and methodology are set.',
      options: ['strict', 'standard', 'loose'],
      default: 'standard',
    })
  }

  if (!a.formatter && !a.skip_formatter) {
    return q({
      id: 'formatter',
      prompt_ko: '포매터를 선택하세요 (auto=언어 기본).',
      prompt_en: 'Preferred formatter? (auto = per-language default)',
      why_ko: '도구별 규칙 파일에 기록됩니다.',
      why_en: 'Written into per-tool rule files.',
      options: [
        'auto',
        'prettier',
        'black/ruff-format',
        'gofmt',
        'rustfmt',
        'dotnet format',
        'none',
      ],
      default: prefill?.formatter || 'auto',
    })
  }

  if (!a.testing && !a.skip_testing) {
    return q({
      id: 'testing',
      prompt_ko: '테스트 프레임워크 선호를 선택하세요.',
      prompt_en: 'Test framework preference?',
      why_ko: '방법론 testing_pyramid와 맞춰 기본값을 잡습니다.',
      why_en: 'Aligned with methodology testing pyramid.',
      options: ['auto', 'vitest', 'jest', 'pytest', 'go test', 'cargo test', 'xunit', 'none'],
      default: prefill?.testing || 'auto',
    })
  }

  if (a.notes === undefined) {
    return q({
      id: 'notes',
      prompt_ko: '추가 코딩 컨벤션이 있으면 입력하세요 (없으면 빈 값).',
      prompt_en: 'Any extra coding conventions? (blank to skip)',
      why_ko: '프로젝트 설명에 덧붙입니다.',
      why_en: 'Appended to the project description.',
      default: '',
    })
  }

  return null
}

function applyDefault(answers: HarnessInterviewAnswers, question: HarnessInterviewQuestion): void {
  const v = question.default ?? ''
  switch (question.id) {
    case 'frontend_language':
      answers.frontend_language = (v || 'typescript') as LanguageId
      break
    case 'backend_language':
      answers.backend_language = (v || 'typescript') as LanguageId
      break
    case 'frontend_framework':
      answers.frontend_framework = v || 'nextjs'
      break
    case 'backend_framework':
      answers.backend_framework = v || 'nestjs'
      break
    case 'package_manager':
      answers.package_manager = (v || 'npm') as PackageManager
      if (!answers.monorepo_tool) answers.monorepo_tool = 'npm-workspaces'
      break
    case 'frontend_architecture':
      answers.frontend_architecture = v as MethodologyId
      break
    case 'backend_architecture':
      answers.backend_architecture = v as MethodologyId
      break
    case 'architecture_notes':
      answers.architecture_notes = v
      break
    case 'strictness':
      answers.strictness = (v || 'standard') as RuleStrictness
      break
    case 'formatter':
      answers.formatter = v || 'auto'
      break
    case 'testing':
      answers.testing = v || 'auto'
      break
    case 'notes':
      answers.notes = v
      break
    default:
      break
  }
}

export async function runHarnessInterview(opts?: {
  projectRoot?: string
  answers?: HarnessInterviewAnswers
  stackHints?: { backend?: string; frontend?: string; mobile?: string; infra?: string }
  nonInteractive?: boolean
  /** Skip filesystem scan (tests) */
  skipScan?: boolean
  prefill?: InterviewPrefill
  project_scan?: ProjectScanResult
}): Promise<HarnessInterviewResult> {
  const scan =
    opts?.project_scan ||
    (opts?.skipScan ? undefined : await scanProject(opts?.projectRoot).catch(() => undefined))
  const prefill = opts?.prefill || scan?.prefill

  let answers = normalizeAnswers(opts?.answers)

  // nonInteractive / CI: prefill silently; interactive: prefill only supplies question defaults
  if (opts?.nonInteractive && prefill) {
    answers = applyPrefill(answers, prefill)
  }

  // Sync languages array from FE/BE once both set
  if (answers.frontend_language && answers.backend_language && !answers.languages?.length) {
    answers.languages = [
      ...new Set([answers.frontend_language, answers.backend_language]),
    ] as LanguageId[]
  }

  // Stack hints fill frameworks only in nonInteractive mode
  if (opts?.nonInteractive) {
    if (!answers.frontend_framework && opts?.stackHints?.frontend) {
      answers.frontend_framework = opts.stackHints.frontend.replace(/\./g, '')
    }
    if (!answers.backend_framework && opts?.stackHints?.backend) {
      answers.backend_framework = opts.stackHints.backend.replace(/\./g, '')
    }
  }

  const next = missingQuestion(answers, prefill)
  if (next && !opts?.nonInteractive) {
    return {
      status: 'pending',
      question: next,
      detected_languages: scan?.languages,
      answers,
      project_scan: scan,
      prefill,
      hint: 'Surface this question; merge answer into interview_answers and call again.',
      hint_ko: '이 질문을 사용자에게 보여주고 답을 interview_answers에 합친 뒤 다시 호출하세요.',
      hint_en: 'Surface this question; merge into interview_answers and re-call.',
    }
  }

  const finalAnswers =
    opts?.nonInteractive && prefill ? applyPrefill({ ...answers }, prefill) : { ...answers }
  for (;;) {
    const mq = missingQuestion(finalAnswers, prefill)
    if (!mq) break
    applyDefault(finalAnswers, mq)
  }

  if (!finalAnswers.frontend_language || !finalAnswers.backend_language) {
    return {
      status: 'error',
      hint: 'frontend_language and backend_language are required',
      answers: finalAnswers,
    }
  }

  const feStack = recommendTechStack('frontend', finalAnswers.frontend_language, {
    ...prefill?.frontend_tech_stack,
    ...finalAnswers.frontend_tech_stack,
    framework: finalAnswers.frontend_framework!,
    package_manager: finalAnswers.package_manager,
    monorepo_tool: finalAnswers.monorepo_tool,
  })
  const beStack = recommendTechStack('backend', finalAnswers.backend_language, {
    ...prefill?.backend_tech_stack,
    ...finalAnswers.backend_tech_stack,
    framework: finalAnswers.backend_framework!,
    package_manager: finalAnswers.package_manager,
    monorepo_tool: finalAnswers.monorepo_tool,
  })
  finalAnswers.frontend_tech_stack = feStack
  finalAnswers.backend_tech_stack = beStack
  // Preserve explicit languages list when provided (legacy + multi-lang rules)
  finalAnswers.languages = finalAnswers.languages?.length
    ? [...new Set(finalAnswers.languages)]
    : [...new Set([finalAnswers.frontend_language, finalAnswers.backend_language])]

  const techSection = renderTechStackSection({
    frontend: feStack,
    backend: beStack,
    package_manager: finalAnswers.package_manager,
    monorepo_tool: finalAnswers.monorepo_tool,
  })
  const archSection = renderArchitectureMethodologySection({
    frontend: finalAnswers.frontend_architecture,
    backend: finalAnswers.backend_architecture,
  })

  let rulesSection = renderLanguageRulesSection(finalAnswers.languages, {
    strictness: finalAnswers.strictness,
  })
  const prefLines: string[] = []
  if (finalAnswers.formatter && finalAnswers.formatter !== 'auto') {
    prefLines.push(`- **Formatter override**: ${finalAnswers.formatter}`)
  }
  if (finalAnswers.testing && finalAnswers.testing !== 'auto') {
    prefLines.push(`- **Test framework override**: ${finalAnswers.testing}`)
  }
  if (finalAnswers.architecture_notes) {
    prefLines.push(`- **Architecture notes**: ${finalAnswers.architecture_notes}`)
  }
  if (scan?.has_source) {
    prefLines.push(`- **Brownfield**: ${scan.brownfield_hard_rule}`)
  }
  if (prefLines.length) {
    rulesSection = `${rulesSection}\n\n### Project preferences\n\n${prefLines.join('\n')}`
  }

  const combinedRules = [archSection, '', techSection, '', rulesSection].join('\n')

  return {
    status: 'complete',
    detected_languages: scan?.languages,
    answers: finalAnswers,
    project_scan: scan,
    prefill,
    rendered_tech_stack_section: techSection,
    rendered_architecture_section: archSection,
    rendered_rules_section: combinedRules,
    rule_section_lines: combinedRules.split('\n').length,
    hint: 'Feed sections into bootstrap_harness / bootstrap_product.',
    hint_ko: 'bootstrap_harness / bootstrap_product에 섹션을 전달하세요.',
    hint_en: 'Pass sections into bootstrap_harness / bootstrap_product.',
  }
}

export { renderLanguageRulesSection, LANGUAGE_RULES, ALL_LANGUAGE_IDS }
