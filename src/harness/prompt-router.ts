import { detectStacksFromText } from "@/harness/stack-playbooks";
import {
  ALL_TOOL_IDS,
  scoreToolMatch,
  TOOL_KEYWORDS,
  ToolKeywordDef,
} from "@/harness/tool-keywords";

/** @deprecated use tool id directly */
export type PromptIntent =
  | "bootstrap_harness"
  | "design_architecture"
  | "bootstrap_domain"
  | "run_domain_loop"
  | "seed_stack_playbooks"
  | "unknown";

export interface PromptRoute {
  /** Matched MCP tool id, or "unknown" */
  tool: string;
  /** @deprecated alias for tool when harness-only */
  intent: PromptIntent | string;
  confidence: number;
  score: number;
  matched_keywords: string[];
  category?: string;
  extracted_task?: string;
  extracted_stacks?: { frontend?: string; backend?: string; mobile?: string };
  extracted_params?: Record<string, unknown>;
  message: string;
  agent_hint: string;
  /** Alternative matches for disambiguation */
  alternatives?: Array<{ tool: string; score: number; matched: string[] }>;
}

const FILLER_RE =
  /^(please|pls|좀|제발|해줘|해 주세요|해주세요|실행|run|call|호출)\s*|\s*(please|pls|좀|제발|해줘|해 주세요|해주세요|실행해|실행)\s*$/gi;

const SESSION_ID_RE = /sess_[a-z0-9]+/i;
const APPROVAL_ID_RE = /appr_[a-z0-9]+/i;

function extractFreeText(message: string, matched: string[]): string {
  let text = message.trim();
  for (const m of matched.sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  text = text.replace(FILLER_RE, " ").replace(/\s+/g, " ").trim();
  return text || message.trim();
}

function buildParams(def: ToolKeywordDef, message: string, matched: string[]): Record<string, unknown> {
  const free = extractFreeText(message, matched);
  const params: Record<string, unknown> = {};

  const sess = message.match(SESSION_ID_RE);
  if (sess) params.session_id = sess[0];

  const appr = message.match(APPROVAL_ID_RE);
  if (appr) params.approval_id = appr[0];

  if (def.textParam) {
    params[def.textParam] = free;
  }

  // Tool-specific defaults from free text
  switch (def.id) {
    case "query_wiki":
    case "recall_knowledge":
      params.query = free;
      params.top_k = 5;
      break;
    case "bootstrap_domain":
    case "run_domain_loop":
      params.task = free;
      break;
    case "design_architecture":
      params.intent = free;
      break;
    case "brainstorm_design":
      params.topic = free;
      break;
    case "spawn_session":
      params.task = free;
      break;
    case "plan_task":
      params.title = free.slice(0, 80) || "Task";
      params.description = free;
      params.success_criteria = ["Complete the described work", "Verify with tests"];
      break;
    case "lint_wiki":
      params.deep = /\b(deep|심층|깊|broken|orphan)\b/i.test(message);
      break;
    case "scan_issues":
      params.spawn_fixes = /\b(fix|수정|spawn|띄)\b/i.test(message);
      params.worktree = /\bworktree|워크트리\b/i.test(message);
      break;
    case "execute_dag":
      params.resume = /\b(resume|재개|checkpoint|체크포인트)\b/i.test(message);
      break;
    case "ingest_raw":
    case "ingest_source":
    case "file_back":
    case "update_wiki_page":
      params.title = free.slice(0, 80) || "Untitled";
      params.content = free;
      break;
    case "store_knowledge":
      params.path = `notes/${Date.now()}`;
      params.content = free;
      break;
    case "request_approval":
      params.action = free.slice(0, 80) || "risky_action";
      params.reason = free;
      params.risk = /\b(critical|치명)\b/i.test(message) ? "critical" : "high";
      break;
    case "resolve_approval":
      params.approved = !/\b(거부|reject|deny|반려)\b/i.test(message);
      break;
    case "get_events":
      params.limit = 50;
      break;
    case "synthesize_results":
      if (sess) params.session_ids = [sess[0]];
      break;
    default:
      break;
  }

  return params;
}

function toLegacyIntent(tool: string): PromptIntent {
  const harness = [
    "bootstrap_harness",
    "design_architecture",
    "bootstrap_domain",
    "run_domain_loop",
    "seed_stack_playbooks",
  ] as const;
  if ((harness as readonly string[]).includes(tool)) return tool as PromptIntent;
  return "unknown";
}

function confidenceFromScore(score: number, minScore: number): number {
  if (score < minScore) return 0;
  return Math.min(0.98, 0.45 + score / 40);
}

export function routePrompt(message: string): PromptRoute {
  const text = message.trim();
  const stacks = detectStacksFromText(text);

  const ranked = TOOL_KEYWORDS.map((def) => {
    const { score, matched } = scoreToolMatch(def, text);
    const min = def.minScore ?? 3;
    return { def, score, matched, min };
  })
    .filter((r) => r.score >= r.min)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    return {
      tool: "unknown",
      intent: "unknown",
      confidence: 0,
      score: 0,
      matched_keywords: [],
      message: text,
      extracted_stacks: stacks,
      agent_hint:
        "No keyword match. Mention tool domain: wiki, session, dag, harness, branch, approval, recall… or call aio_prompt with explicit tool name.",
      alternatives: [],
    };
  }

  const best = ranked[0];
  const params = buildParams(best.def, text, best.matched);
  const free = extractFreeText(text, best.matched);
  const conf = confidenceFromScore(best.score, best.min);

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
    agent_hint: `${best.def.id}: ${best.def.hint}. Matched: ${best.matched.slice(0, 5).join(", ")}`,
    alternatives: ranked.slice(1, 4).map((r) => ({
      tool: r.def.id,
      score: r.score,
      matched: r.matched,
    })),
  };
}

export function routePromptToTool(message: string, toolId?: string): PromptRoute {
  if (toolId && ALL_TOOL_IDS.includes(toolId)) {
    const def = TOOL_KEYWORDS.find((t) => t.id === toolId)!;
    const params = buildParams(def, message, []);
    return {
      tool: toolId,
      intent: toLegacyIntent(toolId),
      confidence: 1,
      score: 100,
      matched_keywords: ["explicit_tool"],
      category: def.category,
      extracted_task: message,
      extracted_params: params,
      message,
      agent_hint: def.hint,
    };
  }
  return routePrompt(message);
}

export function listToolKeywords(): typeof TOOL_KEYWORDS {
  return TOOL_KEYWORDS;
}
