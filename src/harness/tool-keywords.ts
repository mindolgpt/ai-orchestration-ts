/** Keyword registry — every MCP tool routable via substring / pattern scoring */

export interface ToolKeywordDef {
  id: string;
  category: "harness" | "wiki" | "session" | "dag" | "ops" | "branch" | "knowledge";
  keywords: string[];
  /** Extra regex bonus (source stored for hook codegen) */
  patterns?: RegExp[];
  weight?: number;
  /** Minimum score to match (default 3) */
  minScore?: number;
  hint: string;
  /** Primary string param name when executing from free text */
  textParam?: "query" | "task" | "title" | "intent" | "message" | "action";
}

export const TOOL_KEYWORDS: ToolKeywordDef[] = [
  // ── Harness ──
  {
    id: "brainstorm_design",
    category: "harness",
    keywords: [
      "브레인스토밍",
      "brainstorm",
      "기획",
      "prd",
      "요구사항",
      "디자인",
      "ux",
      "ui",
      "와이어",
      "프로토타입",
      "설계 추천",
      "추천해줘",
      "trade-off",
      "db 설계",
      "알고리즘",
      "구현 방식",
      "테스트 전략",
      "보안",
      "어떤 방식",
    ],
    patterns: [
      /브레인\s*스토밍/i,
      /기획\s*(도움|추천|검토)/i,
      /(ux|ui)\s*(설계|검토|추천)/i,
      /디자인\s*(방향|추천|시스템)/i,
      /설계\s*(추천|제안|조언)/i,
      /어떤\s*(방식|알고리즘|패턴)/i,
    ],
    weight: 3,
    textParam: "topic",
    hint: "Full-lifecycle brainstorm: planning, UX, design, domain, DB, security, testing, DevOps…",
  },
  {
    id: "bootstrap_harness",
    category: "harness",
    keywords: ["하네스", "harness", "agents.md", "cursor rule", "hook 설정", "mcp 설정", "bootstrap_harness"],
    patterns: [/하네스\s*(구성|설정|셋업|만들|생성|적용)/i, /harness\s*(setup|bootstrap|configure|init)/i],
    weight: 2,
    textParam: "message",
    hint: "Generate AGENTS.md, Cursor rules/hooks, MCP configs",
  },
  {
    id: "design_architecture",
    category: "harness",
    keywords: ["아키텍처", "architecture", "모듈 구조", "bounded context", "스택 구성", "design_architecture"],
    patterns: [/아키텍처\s*(구성|설계|만들|생성|짜|정의)/i, /architecture\s*(design|setup|create)/i],
    weight: 2,
    textParam: "intent",
    hint: "Wiki + stack based architecture design",
  },
  {
    id: "seed_stack_playbooks",
    category: "harness",
    keywords: ["스택 플레이북", "stack playbook", "playbook 시드", "seed_stack", "베스트 프랙티스 wiki"],
    patterns: [/스택\s*플레이북\s*(시드|넣|추가|생성)/i],
    weight: 2,
    hint: "Seed vault/wiki/stacks/* playbooks",
  },
  {
    id: "run_domain_loop",
    category: "harness",
    keywords: ["도메인 루프", "domain loop", "run_domain_loop", "wiki 기반 개발", "wiki 컨텍스트 구현"],
    weight: 1,
    textParam: "task",
    hint: "Full domain loop brief",
  },
  {
    id: "bootstrap_domain",
    category: "harness",
    keywords: ["도메인 컨텍스트", "bootstrap_domain", "wiki 컨텍스트", "컨텍스트 팩", "harness-context"],
    patterns: [/wiki\s*(조회|검색|컨텍스트)/i],
    weight: 1,
    textParam: "task",
    hint: "Build domain context pack from wiki",
  },
  {
    id: "get_domain_profile",
    category: "harness",
    keywords: ["도메인 프로필", "domain profile", "domain-profile", "get_domain_profile", "프로필 읽"],
    minScore: 4,
    hint: "Read .aio/domain-profile.yaml",
  },
  {
    id: "save_domain_profile",
    category: "harness",
    keywords: ["프로필 저장", "save profile", "save_domain_profile", "도메인 프로필 저장"],
    minScore: 4,
    hint: "Save domain profile",
  },
  {
    id: "list_stack_playbooks",
    category: "harness",
    keywords: ["스택 목록", "list stack", "list_stack", "플레이북 목록", "stack list"],
    minScore: 4,
    hint: "List available stack playbook ids",
  },

  // ── Wiki ──
  {
    id: "query_wiki",
    category: "wiki",
    keywords: ["wiki 검색", "wiki 조회", "query_wiki", "위키 검색", "위키에서", "wiki에서", "도메인 wiki", "wiki 찾"],
    patterns: [/wiki.*(검색|조회|찾)/i, /위키.*(검색|조회|찾)/i],
    weight: 1,
    textParam: "query",
    hint: "Semantic wiki search with citations",
  },
  {
    id: "lint_wiki",
    category: "wiki",
    keywords: ["wiki lint", "lint_wiki", "위키 린트", "wiki 검사", "wiki health", "orphan", "broken link", "위키 점검"],
    patterns: [/wiki\s*lint/i, /위키\s*(점검|검사|lint)/i],
    weight: 2,
    hint: "Wiki structure health check",
  },
  {
    id: "get_wiki_schema",
    category: "wiki",
    keywords: ["wiki schema", "get_wiki_schema", "위키 스키마", "wiki 규칙", "AGENTS.md schema"],
    minScore: 5,
    hint: "Read vault wiki schema",
  },
  {
    id: "ingest_raw",
    category: "wiki",
    keywords: ["raw ingest", "ingest_raw", "원본 저장", "raw 저장", "immutable", "원문 ingest"],
    minScore: 4,
    textParam: "title",
    hint: "Store immutable original under vault/raw/",
  },
  {
    id: "ingest_source",
    category: "wiki",
    keywords: ["wiki ingest", "ingest_source", "위키 ingest", "개념 페이지", "wiki 페이지 생성", "wiki 추가"],
    minScore: 4,
    textParam: "title",
    hint: "Create/update one wiki concept page",
  },
  {
    id: "update_wiki_page",
    category: "wiki",
    keywords: ["wiki 수정", "update_wiki", "위키 수정", "wiki 업데이트", "페이지 수정"],
    minScore: 4,
    textParam: "title",
    hint: "Update existing wiki page",
  },
  {
    id: "file_back",
    category: "wiki",
    keywords: ["file_back", "wiki 반영", "위키 반영", "wiki 기록", "지식 저장 wiki", "wiki에 저장", "file back"],
    weight: 1,
    textParam: "title",
    hint: "Write durable synthesis back to wiki",
  },

  // ── Session ──
  {
    id: "spawn_session",
    category: "session",
    keywords: ["spawn session", "spawn_session", "세션 생성", "세션 띄", "병렬 세션", "자식 세션", "child session", "에이전트 실행", "서브 에이전트"],
    patterns: [/세션\s*(생성|띄|spawn|시작)/i, /spawn\s*session/i],
    weight: 2,
    textParam: "task",
    hint: "Spawn isolated child AI session",
  },
  {
    id: "check_inbox",
    category: "session",
    keywords: ["check inbox", "check_inbox", "인박스", "inbox 확인", "세션 결과", "결과 poll"],
    weight: 2,
    hint: "Poll child session results",
  },
  {
    id: "list_sessions",
    category: "session",
    keywords: ["list sessions", "list_sessions", "세션 목록", "세션 리스트", "running sessions"],
    minScore: 4,
    hint: "List all sessions",
  },
  {
    id: "get_session",
    category: "session",
    keywords: ["get session", "get_session", "세션 상태", "session status", "sess_"],
    patterns: [/sess_[a-z0-9]+/i],
    minScore: 4,
    hint: "Get session status and logs",
  },
  {
    id: "close_session",
    category: "session",
    keywords: ["close session", "close_session", "세션 종료", "세션 kill", "세션 닫"],
    minScore: 4,
    hint: "Kill and remove session",
  },
  {
    id: "send_message",
    category: "session",
    keywords: ["send message", "send_message", "세션 메시지", "세션에 전달", "instruction queue"],
    minScore: 5,
    textParam: "message",
    hint: "Queue instruction for session",
  },
  {
    id: "report_result",
    category: "session",
    keywords: ["report result", "report_result", "결과 보고", "세션 보고"],
    minScore: 5,
    hint: "Child reports result to inbox",
  },
  {
    id: "synthesize_results",
    category: "session",
    keywords: ["synthesize", "synthesize_results", "결과 합성", "세션 합성", "결과 요약", "merge results"],
    weight: 1,
    hint: "Synthesize child/DAG results",
  },

  // ── DAG ──
  {
    id: "plan_task",
    category: "dag",
    keywords: ["plan task", "plan_task", "작업 계획", "플랜", "계획 세우", "태스크 분해", "decompose", "DAG 계획"],
    patterns: [/계획\s*(세|짜|만들)/i, /plan\s*task/i],
    weight: 2,
    textParam: "title",
    hint: "Create plan and suggested DAG stubs",
  },
  {
    id: "execute_dag",
    category: "dag",
    keywords: ["execute dag", "execute_dag", "DAG 실행", "dag 실행", "병렬 실행", "체크포인트 재개", "resume dag"],
    patterns: [/dag\s*(실행|execute)/i, /execute\s*dag/i],
    weight: 2,
    hint: "Execute DAG (needs tasks from plan_task)",
  },

  // ── Ops ──
  {
    id: "run_doctor",
    category: "ops",
    keywords: ["doctor", "run_doctor", "진단", "헬스체크", "health check", "온보딩", "onboarding", "셋업 확인"],
    patterns: [/aio\s*doctor/i, /프로젝트\s*진단/i, /설치\s*확인/i],
    weight: 2,
    hint: "Run project health / onboarding diagnostic",
  },
  {
    id: "request_approval",
    category: "ops",
    keywords: ["approval", "request_approval", "승인 요청", "승인 필요", "human in the loop"],
    minScore: 4,
    textParam: "action",
    hint: "Create approval gate",
  },
  {
    id: "resolve_approval",
    category: "ops",
    keywords: ["resolve approval", "resolve_approval", "승인 처리", "승인 거부", "approve"],
    minScore: 5,
    hint: "Approve or reject pending approval",
  },
  {
    id: "list_approvals",
    category: "ops",
    keywords: ["list approvals", "list_approvals", "승인 목록", "pending approval"],
    minScore: 4,
    hint: "List approval requests",
  },
  {
    id: "get_events",
    category: "ops",
    keywords: ["events", "get_events", "이벤트 로그", "events.jsonl", "observability", "로그 조회"],
    minScore: 4,
    hint: "Recent orchestrator events",
  },
  {
    id: "list_worktrees",
    category: "ops",
    keywords: ["worktree", "list_worktrees", "워크트리", "worktree 목록"],
    minScore: 4,
    hint: "List git worktrees",
  },
  {
    id: "remove_worktree",
    category: "ops",
    keywords: ["remove worktree", "remove_worktree", "워크트리 삭제", "worktree 제거"],
    minScore: 5,
    hint: "Remove aio session worktree",
  },

  // ── Branch ──
  {
    id: "scan_issues",
    category: "branch",
    keywords: ["scan issues", "scan_issues", "TODO 스캔", "FIXME", "branch hunt", "이슈 스캔", "코드 스캔", "rg 스캔"],
    patterns: [/todo\s*스캔/i, /scan\s*issues/i, /branch\s*hunt/i],
    weight: 2,
    hint: "Scan codebase for TODO/FIXME/HACK",
  },
  {
    id: "collect_results",
    category: "branch",
    keywords: ["collect results", "collect_results", "branch 결과", "hunt 결과 수집"],
    minScore: 5,
    hint: "Collect branch-hunt results",
  },
  {
    id: "get_branch_status",
    category: "branch",
    keywords: ["branch status", "get_branch_status", "branch hunt 상태", "hunt 상태"],
    minScore: 5,
    hint: "Branch hunt status summary",
  },

  // ── Knowledge ──
  {
    id: "recall_knowledge",
    category: "knowledge",
    keywords: ["recall", "recall_knowledge", "지식 검색", "semantic search", "의미 검색", "recall knowledge", "기억"],
    patterns: [/지식\s*(검색|찾|조회)/i, /recall\s*knowledge/i],
    weight: 1,
    textParam: "query",
    hint: "Semantic search knowledge base",
  },
  {
    id: "store_knowledge",
    category: "knowledge",
    keywords: ["store knowledge", "store_knowledge", "지식 저장", "vault 저장", "note 저장"],
    minScore: 4,
    textParam: "query",
    hint: "Save to Obsidian vault",
  },
];

export const ALL_TOOL_IDS = TOOL_KEYWORDS.map((t) => t.id);

export function scoreToolMatch(
  def: ToolKeywordDef,
  text: string
): { score: number; matched: string[] } {
  const lower = text.toLowerCase();
  let score = def.weight || 0;
  const matched: string[] = [];

  for (const kw of def.keywords) {
    const k = kw.toLowerCase();
    if (lower.includes(k)) {
      score += Math.max(k.length, 2);
      matched.push(kw);
    }
  }
  for (const re of def.patterns || []) {
    if (re.test(text)) {
      score += 12;
      matched.push(re.source.slice(0, 40));
    }
  }
  return { score, matched };
}

export function findToolDef(id: string): ToolKeywordDef | undefined {
  return TOOL_KEYWORDS.find((t) => t.id === id);
}

/** Compact rules embedded in Cursor hook (pattern source strings) */
export function hookKeywordRules(): Array<{ tool: string; sources: string[] }> {
  return TOOL_KEYWORDS.filter((t) => t.id !== "aio_prompt").map((t) => ({
    tool: t.id,
    sources: [
      ...t.keywords.slice(0, 6).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      ...(t.patterns?.map((p) => p.source) || []),
    ],
  }));
}
