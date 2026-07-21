import { detectStacksFromText } from '@/harness/stack-playbooks'
import {
  ALL_TOOL_IDS,
  scoreToolMatch,
  TOOL_KEYWORDS,
  ToolKeywordDef,
} from '@/harness/tool-keywords'

/** @deprecated use tool id directly */
export type PromptIntent =
  | 'bootstrap_harness'
  | 'design_architecture'
  | 'bootstrap_domain'
  | 'run_domain_loop'
  | 'seed_stack_playbooks'
  | 'unknown'

export interface PromptRoute {
  /** Matched MCP tool id, or "unknown" */
  tool: string
  /** @deprecated alias for tool when harness-only */
  intent: string
  confidence: number
  score: number
  matched_keywords: string[]
  category?: string
  extracted_task?: string
  extracted_stacks?: { frontend?: string; backend?: string; mobile?: string }
  extracted_params?: Record<string, unknown>
  message: string
  agent_hint: string
  /** Alternative matches for disambiguation */
  alternatives?: Array<{ tool: string; score: number; matched: string[] }>
}

const FILLER_RE =
  /^(please|pls|좀|제발|해줘|해 주세요|해주세요|실행|run|call|호출)\s*|\s*(please|pls|좀|제발|해줘|해 주세요|해주세요|실행해|실행)\s*$/gi

const SESSION_ID_RE = /sess_[a-z0-9]+/i
const APPROVAL_ID_RE = /appr_[a-z0-9]+/i

function extractPathFromMessage(message: string): string | undefined {
  const win = message.match(/[A-Za-z]:\\[^\s"'`,]+/)
  if (win) return win[0]
  const vaultRaw = message.match(/(?:\.\/)?vault\/raw\/[^\s"'`,]+\.(md|txt|json|yaml|yml)/i)
  if (vaultRaw) return vaultRaw[0]
  const unix = message.match(/(?:\.?\/)?[\w./-]+\.(md|txt|json|yaml|yml|csv|xml|html)/i)
  return unix?.[0]
}

function extractRawIdFromMessage(message: string): string | undefined {
  const explicit = message.match(/\braw_id\s*[=:]\s*([a-z0-9]{6,12})\b/i)
  if (explicit) return explicit[1]
  const fromPath = message.match(/\braw\/([a-z0-9]{6,12})--/i)
  if (fromPath) return fromPath[1]
  const bare = message.match(/\b(?:raw\s*id|rawid)\s+([a-z0-9]{6,12})\b/i)
  return bare?.[1]
}

function looksLikeReingestRequest(message: string): boolean {
  return /(다시|재\s*ingest|re-?ingest|기존\s*raw|raw\s*파일\s*보고|from\s+raw|skip_raw)/i.test(
    message
  )
}

/**
 * Pull scale/phase from follow-ups.
 * Conservative: bare tokens ("design") or explicit markers ("phase: design", "단계는 설계").
 * Does NOT treat "UX 디자인" inside a long topic as phase — that skipped questions incorrectly.
 */
export function extractBrainstormAnswersFromMessage(message: string): Record<string, string> {
  const answers: Record<string, string> = {}
  const text = message.trim()
  const lower = text.toLowerCase()

  const scaleMarked = lower.match(/(?:scale|규모)\s*[:=]?\s*(mvp|growth|enterprise)\b/)?.[1]
  if (scaleMarked) answers.scale = scaleMarked
  if (!answers.scale && /^(mvp|growth|enterprise)$/i.test(text)) {
    answers.scale = text.toLowerCase()
  }

  const phaseMarked = lower.match(
    /(?:phase|단계)\s*[:=]?\s*(discovery|design|build|ship|operate)\b/
  )?.[1]
  const phaseKoMarked = text.match(
    /(?:phase|단계)\s*[:=]?\s*(디스커버리|설계|디자인|구현|빌드|출시|운영)/
  )?.[1]
  if (phaseMarked) {
    answers.phase = phaseMarked
  } else if (phaseKoMarked) {
    const map: Record<string, string> = {
      디스커버리: 'discovery',
      설계: 'design',
      디자인: 'design',
      구현: 'build',
      빌드: 'build',
      출시: 'ship',
      운영: 'operate',
    }
    answers.phase = map[phaseKoMarked]
  }
  if (!answers.phase && /^(discovery|design|build|ship|operate)$/i.test(text)) {
    answers.phase = text.toLowerCase()
  }

  return answers
}

function applyIngestDocumentParams(
  params: Record<string, unknown>,
  message: string,
  free: string
): void {
  const filePath = extractPathFromMessage(message)
  const rawId = extractRawIdFromMessage(message)
  if (filePath) params.file_path = filePath
  if (rawId) {
    params.raw_id = rawId
    if (looksLikeReingestRequest(message)) params.skip_raw = true
  } else if (looksLikeReingestRequest(message) && /raw/i.test(message)) {
    // Re-ingest intent without id — do not treat chat as document body
    params.skip_raw = true
  }

  const substantial = free.trim().length >= 80 && !looksLikeReingestRequest(message)
  if (substantial && !filePath && !rawId) {
    params.title = free.slice(0, 80)
    params.content = free
  } else if (filePath || rawId) {
    if (free.trim()) params.title = free.slice(0, 80)
  }
  // Intentionally omit content when only command text remains — executor will refuse
}

function stripMatchedToken(text: string, token: string): string {
  if (token.startsWith('re:')) {
    try {
      return text.replace(new RegExp(token.slice(3), 'gi'), ' ')
    } catch {
      return text
    }
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Prefer whole-token removal so "brainstorm" does not leave "_design" from brainstorm_design
  if (/^[a-z0-9_]+$/i.test(token)) {
    return text.replace(new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'gi'), ' ')
  }
  return text.replace(new RegExp(escaped, 'gi'), ' ')
}

function extractFreeText(message: string, matched: string[]): string {
  let text = message.trim()
  // Strip explicit tool ids first (longest first) — avoids "brainstorm" → "_design" leftovers
  for (const id of [...ALL_TOOL_IDS].sort((a, b) => b.length - a.length)) {
    text = text.replace(
      new RegExp(`(?:^|[^a-z0-9])${id.replace(/_/g, '[_ ]?')}(?:[^a-z0-9]|$)`, 'gi'),
      ' '
    )
  }
  for (const m of matched.sort((a, b) => b.length - a.length)) {
    text = stripMatchedToken(text, m)
  }
  text = text
    .replace(FILLER_RE, ' ')
    .replace(/^[_-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || message.trim()
}

function buildParams(
  def: ToolKeywordDef,
  message: string,
  matched: string[]
): Record<string, unknown> {
  const free = extractFreeText(message, matched)
  const params: Record<string, unknown> = {}

  const sess = message.match(SESSION_ID_RE)
  if (sess) params.session_id = sess[0]

  const appr = message.match(APPROVAL_ID_RE)
  if (appr) params.approval_id = appr[0]

  if (def.textParam) {
    params[def.textParam] = free
  }

  // Tool-specific defaults from free text
  switch (def.id) {
    case 'query_wiki':
    case 'recall_knowledge':
      params.query = free
      params.top_k = 5
      break
    case 'bootstrap_domain':
    case 'run_domain_loop':
      params.task = free
      break
    case 'design_architecture':
      params.intent = free
      break
    case 'brainstorm_design': {
      params.topic = free
      const answers = extractBrainstormAnswersFromMessage(message)
      if (Object.keys(answers).length) params.answers = answers
      break
    }
    case 'spawn_session':
      params.task = free
      break
    case 'plan_task':
      params.title = free.slice(0, 80) || 'Task'
      params.description = free
      params.success_criteria = ['Complete the described work', 'Verify with tests']
      break
    case 'lint_wiki':
      params.deep = /\b(deep|심층|깊|broken|orphan)\b/i.test(message)
      params.stale_days = 90
      break
    case 'scan_issues':
      params.spawn_fixes = /\b(fix|수정|spawn|띄)\b/i.test(message)
      params.worktree = /\bworktree|워크트리\b/i.test(message)
      break
    case 'execute_dag':
      params.resume = /\b(resume|재개|checkpoint|체크포인트)\b/i.test(message)
      break
    case 'ingest_raw':
    case 'ingest_source':
    case 'ingest_source_batch':
      applyIngestDocumentParams(params, message, free)
      if (!params.title) params.title = free.slice(0, 80) || undefined
      break
    case 'file_back':
    case 'update_wiki_page':
      params.title = free.slice(0, 80) || 'Untitled'
      params.content = free
      break
    case 'ingest_pipeline':
      applyIngestDocumentParams(params, message, free)
      params.run_lint = !/\b(no lint|lint 없|skip lint)\b/i.test(message)
      params.lint_deep = /\b(deep|심층)\b/i.test(message)
      break
    case 'store_knowledge':
      params.path = `notes/${Date.now()}`
      params.content = free
      break
    case 'request_approval':
      params.action = free.slice(0, 80) || 'risky_action'
      params.reason = free
      params.risk = /\b(critical|치명)\b/i.test(message) ? 'critical' : 'high'
      break
    case 'resolve_approval':
      params.approved = !/\b(거부|reject|deny|반려)\b/i.test(message)
      {
        const code = message.match(/\b(?:confirm[_ ]?code|코드)[:\s]*([a-f0-9]{16})\b/i)
        if (code) params.confirm_code = code[1]
      }
      break
    case 'get_events':
      params.limit = 50
      break
    case 'synthesize_results':
      if (sess) params.session_ids = [sess[0]]
      break
    default:
      break
  }

  return params
}

function toLegacyIntent(tool: string): PromptIntent {
  const harness = [
    'bootstrap_harness',
    'design_architecture',
    'bootstrap_domain',
    'run_domain_loop',
    'seed_stack_playbooks',
  ] as const
  if ((harness as readonly string[]).includes(tool)) return tool as PromptIntent
  return 'unknown'
}

function confidenceFromScore(score: number, minScore: number): number {
  if (score < minScore) return 0
  return Math.min(0.98, 0.45 + score / 40)
}

export function routePrompt(message: string): PromptRoute {
  const text = message.trim()
  const stacks = detectStacksFromText(text)

  const ranked = TOOL_KEYWORDS.map((def) => {
    const { score, matched } = scoreToolMatch(def, text)
    const min = def.minScore ?? 3
    return { def, score, matched, min }
  })
    .filter((r) => r.score >= r.min)
    .sort((a, b) => b.score - a.score)

  if (!ranked.length) {
    return {
      tool: 'unknown',
      intent: 'unknown',
      confidence: 0,
      score: 0,
      matched_keywords: [],
      message: text,
      extracted_stacks: stacks,
      agent_hint:
        'No keyword match. Mention tool domain: wiki, session, dag, harness, branch, approval, recall… or call aio_prompt with explicit tool name.',
      alternatives: [],
    }
  }

  const best = ranked[0]
  const params = buildParams(best.def, text, best.matched)
  const free = extractFreeText(text, best.matched)
  const conf = confidenceFromScore(best.score, best.min)
  const ambiguous =
    ranked.length > 1 && best.score - ranked[1].score < 3
      ? ` Ambiguous (${best.score} vs ${ranked[1].score}) — alternatives: ${ranked
          .slice(1, 3)
          .map((r) => r.def.id)
          .join(', ')}.`
      : ''

  return {
    tool: best.def.id,
    intent: toLegacyIntent(best.def.id),
    confidence: conf,
    score: best.score,
    matched_keywords: best.matched,
    category: best.def.category,
    extracted_task: free,
    extracted_stacks: stacks,
    extracted_params: params,
    message: text,
    agent_hint: `${best.def.id}: ${best.def.hint}. Matched: ${best.matched.slice(0, 5).join(', ')}.${ambiguous}`,
    alternatives: ranked.slice(1, 4).map((r) => ({
      tool: r.def.id,
      score: r.score,
      matched: r.matched,
    })),
  }
}

export function routePromptToTool(message: string, toolId?: string): PromptRoute {
  if (toolId && ALL_TOOL_IDS.includes(toolId)) {
    const def = TOOL_KEYWORDS.find((t) => t.id === toolId)!
    const params = buildParams(def, message, [])
    return {
      tool: toolId,
      intent: toLegacyIntent(toolId),
      confidence: 1,
      score: 100,
      matched_keywords: ['explicit_tool'],
      category: def.category,
      extracted_task: message,
      extracted_params: params,
      message,
      agent_hint: def.hint,
    }
  }
  return routePrompt(message)
}

export function listToolKeywords(): typeof TOOL_KEYWORDS {
  return TOOL_KEYWORDS
}
