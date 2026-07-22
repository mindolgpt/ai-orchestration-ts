/**
 * Harness bootstrap interview wizard.
 *
 * Drives an interactive Q&A so the user can confirm/adjust the auto-detected
 * project languages, choose rule strictness, and pick formatter/test defaults.
 * The answers are then fed back into bootstrap_harness so the language-optimized
 * rules are injected into per-tool rule files (AGENTS.md, CLAUDE.md, Cursor MDC,
 * Windsurf/Continue rules, OpenCode instructions).
 *
 * The wizard is stateless + resumable: callers pass `answers` on each call and
 * receive either a `pending` prompt to surface to the user OR a `complete`
 * payload with the resolved harness configuration. This keeps the MCP tool
 * idempotent when run from a chat session.
 */

import { detectLanguages, DetectedLanguage } from '@/harness/detect-language'
import {
  ALL_LANGUAGE_IDS,
  LANGUAGE_RULES,
  LanguageId,
  renderLanguageRulesSection,
} from '@/harness/language-rules'
import { detectLanguagesFromStacks } from '@/harness/language-rules'

export type RuleStrictness = 'strict' | 'standard' | 'loose'
export type FormatterChoice = 'auto' | 'none' | (string & {})
export type TestingChoice = 'auto' | 'none' | (string & {})

export interface HarnessInterviewAnswers {
  /** Languages explicitly confirmed by the user; overrides detection */
  languages?: LanguageId[]
  strictness?: RuleStrictness
  formatter?: FormatterChoice
  testing?: TestingChoice
  /** AI tool targets override (already supported by bootstrap_harness) */
  targets?: string[]
  /** User declined specific sections — internal */
  skip_formatter?: boolean
  skip_testing?: boolean
  /** Free-form project notes appended to profile.description */
  notes?: string
}

export interface HarnessInterviewQuestion {
  id: keyof HarnessInterviewAnswers | 'confirm_languages'
  prompt: string
  why: string
  options?: string[]
  /** Default value if user skips / answers nothing */
  default?: string
}

export interface HarnessInterviewResult {
  status: 'pending' | 'complete' | 'error'
  question?: HarnessInterviewQuestion
  /** Languages detected so far — surfaced so the user can react */
  detected_languages?: DetectedLanguage[]
  /** Resolved answers including defaults applied for skipped questions */
  answers?: HarnessInterviewAnswers
  /** Only present when status==='complete' */
  rendered_rules_section?: string
  rule_section_lines?: number
  hint?: string
}

function missingQuestion(
  answers: HarnessInterviewAnswers | undefined,
  detected: DetectedLanguage[]
): HarnessInterviewQuestion | null {
  const a = answers || {}

  if (!a.languages?.length) {
    return {
      id: 'confirm_languages',
      prompt: detected.length
        ? `Detected languages: ${detected
            .map((d) => `${d.label} (${d.confidence})`)
            .join(', ')}. Confirm or override (comma-separated).`
        : 'No languages detected from manifests. Which languages should I generate rules for?',
      why: 'Language rules are tailored per-language (naming, lint, formatter, tests).',
      options: detected.length ? detected.map((d) => d.id) : ALL_LANGUAGE_IDS.slice(0, 8),
      default: detected.length ? detected.map((d) => d.id).join(',') : '',
    }
  }

  if (!a.strictness) {
    return {
      id: 'strictness',
      prompt: 'How strict should the rules be enforced in CI?',
      why: 'Affects how rule violations surface in builds.',
      options: ['strict', 'standard', 'loose'],
      default: 'standard',
    }
  }

  if (!a.formatter && !a.skip_formatter) {
    return {
      id: 'formatter',
      prompt:
        'Preferred formatter? Leave blank for per-language defaults (Prettier, ruff, gofmt, rustfmt, ...).',
      why: 'Injected as a reference in tool rules; agents follow what you already use.',
      options: [
        'auto',
        'prettier',
        'black/ruff-format',
        'gofmt',
        'rustfmt',
        'dotnet format',
        'none',
      ],
      default: 'auto',
    }
  }

  if (!a.testing && !a.skip_testing) {
    return {
      id: 'testing',
      prompt:
        'Test framework preference? Leave blank for per-language defaults (Vitest, pytest, go test, cargo test, ...).',
      why: 'Documents the project convention for agents generating tests.',
      options: [
        'auto',
        'vitest',
        'jest',
        'pytest',
        'go test',
        'cargo test',
        'xunit',
        'rspec',
        'none',
      ],
      default: 'auto',
    }
  }

  if (!a.notes && a.notes !== '') {
    return {
      id: 'notes',
      prompt: 'Any extra coding conventions to document? (free text, blank to skip).',
      why: 'Appends extra context to the project description for agents.',
      default: '',
    }
  }

  return null
}

/**
 * Run the wizard one step at a time. Pass current answers; receive either:
 *  - { status:'pending', question } — surface this to the user and call again
 *    with their answer merged into `answers`, or
 *  - { status:'complete', rendered_rules_section, answers } — ready to feed
 *    back into bootstrap_harness.
 *
 * In non-interactive mode (no answer on a step), accept the default and keep
 * going so a single MCP call with no provided answers still returns a complete
 * pack (best-effort) — callers passing explicit `answers` skip prompts.
 */
export async function runHarnessInterview(opts?: {
  projectRoot?: string
  answers?: HarnessInterviewAnswers
  /** Detected stack hints (e.g. from domain profile) merged into language set */
  stackHints?: { backend?: string; frontend?: string; mobile?: string; infra?: string }
  /** If true, auto-accept all defaults rather than return pending state */
  nonInteractive?: boolean
}): Promise<HarnessInterviewResult> {
  const detection = await detectLanguages(opts?.projectRoot)

  let confirmed = opts?.answers?.languages?.length ? opts.answers.languages : undefined

  // Merge detected languages with stack hints so backend-only manifests still
  // surface language rules (e.g. Next.js detected via domain profile stack)
  const fromStacks = opts?.stackHints ? detectLanguagesFromStacks(opts.stackHints) : []
  const stackOnly = fromStacks.filter((id) => !detection.languages.some((d) => d.id === id))
  const detected = [...detection.languages]
  for (const id of stackOnly) {
    detected.push({
      id,
      label: LANGUAGE_RULES[id].label,
      evidence: 'inferred from detected stack',
      confidence: 1,
    })
  }

  if (!confirmed && detected.length) {
    confirmed = detected.map((d) => d.id)
  }

  const baseAnswers: HarnessInterviewAnswers = {
    ...opts?.answers,
    languages: confirmed,
  }

  const nextQuestion = missingQuestion(baseAnswers, detected)

  if (nextQuestion && !opts?.nonInteractive) {
    return {
      status: 'pending',
      question: nextQuestion,
      detected_languages: detected,
      answers: baseAnswers,
      hint: 'Surface this question to the user; merge their answer into `answers` and call runHarnessInterview again.',
    }
  }

  // Apply defaults for any remaining unanswered questions
  const finalAnswers: HarnessInterviewAnswers = { ...baseAnswers }
  for (;;) {
    const q = missingQuestion(finalAnswers, detected)
    if (!q) break
    const defaultVal = q.default ?? ''
    if (q.id === 'notes') {
      finalAnswers.notes = defaultVal
      continue
    }
    // strictness, formatter, testing, confirm_languages
    switch (q.id) {
      case 'confirm_languages':
        finalAnswers.languages = confirmed || []
        break
      case 'strictness':
        finalAnswers.strictness = (defaultVal || 'standard') as RuleStrictness
        break
      case 'formatter':
        finalAnswers.formatter = defaultVal || 'auto'
        break
      case 'testing':
        finalAnswers.testing = defaultVal || 'auto'
        break
    }
  }

  // Filter out languages the user overrode away from (case-insensitive)
  const languages = (finalAnswers.languages || []).filter((id) => ALL_LANGUAGE_IDS.includes(id))

  if (!languages.length) {
    return {
      status: 'error',
      hint: 'No languages confirmed. Provide answers.languages with at least one valid language id.',
    }
  }

  let section = renderLanguageRulesSection(languages, {
    strictness: finalAnswers.strictness,
  })

  // Annotate user's formatter/testing preferences if they diverged from auto
  const prefLines: string[] = []
  if (finalAnswers.formatter && finalAnswers.formatter !== 'auto') {
    prefLines.push(`- **Formatter override**: ${finalAnswers.formatter}`)
  }
  if (finalAnswers.testing && finalAnswers.testing !== 'auto') {
    prefLines.push(`- **Test framework override**: ${finalAnswers.testing}`)
  }
  if (prefLines.length) {
    section = `${section}\n\n### Project preferences\n\n${prefLines.join('\n')}`
  }

  // Append notes into the profile description so templates can display them
  // (The bootstrap caller merges notes into profile.description separately.)

  return {
    status: 'complete',
    detected_languages: detected,
    answers: finalAnswers,
    rendered_rules_section: section,
    rule_section_lines: section.split('\n').length,
    hint: 'Feed rendered_rules_section back into bootstrap_harness via the `language_rules_section` option (or pass `answers` so bootstrap can re-render).',
  }
}

export { renderLanguageRulesSection, LANGUAGE_RULES, ALL_LANGUAGE_IDS }
