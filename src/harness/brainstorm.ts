/**
 * Full-lifecycle development brainstorm — planning, design, domain, DB, algo, security, ops, …
 * Returns structured brief; connected agent facilitates multi-lens discussion with user.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { ObsidianVault } from "@/knowledge/vault";
import { SemanticSearch } from "@/knowledge/search";
import { resolveProjectRoot } from "@/knowledge/paths";
import { buildDomainContextPack } from "@/harness/context-pack";
import { loadDomainProfile } from "@/harness/profile";
import { detectStacksFromText } from "@/harness/stack-playbooks";
import {
  BrainstormFocus,
  BrainstormOption,
  BrainstormQuestion,
  BrainstormLens,
  BrainstormAnswers,
  BrainstormResult,
} from "@/harness/brainstorm-types";
import {
  collectFocusPlaybooks,
  detectFocusFromTopic,
  DEVELOPMENT_LENSES,
} from "@/harness/brainstorm-focus";

export type { BrainstormFocus, BrainstormOption, BrainstormQuestion, BrainstormAnswers, BrainstormResult };

interface DomainPatternRule {
  keywords: string[];
  focus: BrainstormFocus[];
  questions: BrainstormQuestion[];
  options: Omit<BrainstormOption, "wiki_citations">[];
}

const DOMAIN_PATTERNS: DomainPatternRule[] = [
  {
    keywords: ["장바구니", "cart", "basket"],
    focus: ["domain", "database", "algorithm", "ux"],
    questions: [
      {
        id: "cart_identity",
        focus: "domain",
        question: "비로그인/로그인 장바구니 merge 정책은?",
        why: "BC 경계와 저장 키 설계",
        options: ["session only", "user only", "merge on login"],
      },
      {
        id: "cart_ux",
        focus: "ux",
        question: "장바구니 이탈 복구 UX? (이메일 리마인더, 저장 배너)",
        why: "기획·마케팅 연계",
      },
    ],
    options: [
      {
        name: "Redis Hash per user/session",
        focus: "database",
        approach: "cart:{userId} 또는 session:{id} Hash, TTL 7~30일",
        pros: ["고속 read/write", "wiki 장바구니 패턴과 일치"],
        cons: ["영구 감사 로그 부족"],
        when_to_use: "MVP~growth, 임시 mutable cart",
        complexity: "low",
        stack_hints: ["redis", "spring-boot"],
      },
      {
        name: "Optimistic UI cart updates",
        focus: "ux",
        approach: "담기 즉시 UI 반영, 실패 시 토스트+롤백",
        pros: ["체감 속도", "전환율"],
        cons: ["재고 불일치 UX"],
        when_to_use: "B2C 쇼핑",
        complexity: "medium",
        stack_hints: ["react"],
      },
    ],
  },
  {
    keywords: ["주문", "order", "checkout", "체크아웃"],
    focus: ["domain", "planning", "ux", "algorithm"],
    questions: [
      {
        id: "checkout_steps",
        focus: "planning",
        question: "게스트 체크아웃 허용? 회원 전용?",
        why: "기획·인증·전환율",
      },
      {
        id: "order_idempotency",
        focus: "algorithm",
        question: "결제 재시도 멱등 키 전략?",
        why: "중복 주문 방지",
      },
    ],
    options: [
      {
        name: "Guest checkout + optional account",
        focus: "planning",
        approach: "이메일만으로 주문, 이후 계정 연결 유도",
        pros: ["전환율↑"],
        cons: ["주문 추적 복잡"],
        when_to_use: "B2C MVP",
        complexity: "medium",
        stack_hints: [],
      },
      {
        name: "Saga (choreography)",
        focus: "algorithm",
        approach: "Order→Payment→Inventory 이벤트, 실패 시 보상",
        pros: ["MSA 적합"],
        cons: ["운영 복잡"],
        when_to_use: "growth+, 이벤트 인프라",
        complexity: "high",
        stack_hints: ["kafka"],
      },
    ],
  },
  {
    keywords: ["결제", "payment", "pg"],
    focus: ["domain", "security", "integration", "algorithm"],
    questions: [
      {
        id: "payment_compliance",
        focus: "security",
        question: "PCI 범위 — 카드정보 직접 처리 vs PG 위임?",
        why: "보안·인증 비용",
      },
    ],
    options: [
      {
        name: "PG-hosted payment (recommended)",
        focus: "security",
        approach: "카드 입력은 PG iframe/redirect, 우리는 토큰만",
        pros: ["PCI 범위 축소"],
        cons: ["PG 종속"],
        when_to_use: "대부분의 쇼핑몰",
        complexity: "medium",
        stack_hints: [],
      },
    ],
  },
  {
    keywords: ["재고", "inventory", "stock"],
    focus: ["domain", "database", "algorithm"],
    questions: [
      {
        id: "inventory_oversell",
        focus: "planning",
        question: "품절 시 UX? (대기, 알림, 대체상품)",
        why: "기획·알림 인프라",
      },
    ],
    options: [
      {
        name: "Reservation pattern",
        focus: "algorithm",
        approach: "available→reserved, 결제 실패 release",
        pros: ["oversell 방지"],
        cons: ["만료 스케줄러"],
        when_to_use: "동시 주문",
        complexity: "medium",
        stack_hints: ["redis", "postgresql"],
      },
    ],
  },
  {
    keywords: ["인증", "auth", "login", "회원"],
    focus: ["domain", "security", "api", "ux"],
    questions: [
      {
        id: "auth_ux",
        focus: "ux",
        question: "소셜 로그인 필수? 이메일만?",
        why: "온보딩 마찰 vs 전환",
      },
    ],
    options: [
      {
        name: "OAuth2 social + email fallback",
        focus: "ux",
        approach: "카카오/구글 원탭, 이메일은 보조",
        pros: ["가입 전환↑"],
        cons: ["연동 유지보수"],
        when_to_use: "한국 B2C",
        complexity: "medium",
        stack_hints: ["spring-boot"],
      },
    ],
  },
  {
    keywords: ["검색", "search", "catalog", "카탈로그"],
    focus: ["database", "ux", "performance"],
    questions: [
      {
        id: "search_ux",
        focus: "ux",
        question: "자동완성·필터·정렬 우선순위?",
        why: "기획·인덱스 설계",
      },
    ],
    options: [
      {
        name: "PostgreSQL FTS (MVP)",
        focus: "database",
        approach: "tsvector + GIN, 단순 필터",
        pros: ["인프라 단순"],
        cons: ["한글·스케일 한계"],
        when_to_use: "MVP <100k SKU",
        complexity: "low",
        stack_hints: ["postgresql"],
      },
    ],
  },
];

const SCALE_QUESTIONS: BrainstormQuestion[] = [
  {
    id: "scale",
    focus: "general",
    question: "목표 규모? (MVP / growth / enterprise)",
    why: "모든 렌즈에서 복잡도 조절",
    options: ["mvp", "growth", "enterprise"],
  },
  {
    id: "phase",
    focus: "planning",
    question: "지금 단계는? (discovery / design / build / ship / operate)",
    why: "어떤 렌즈를 깊게 볼지",
    options: ["discovery", "design", "build", "ship", "operate"],
  },
];

function matchDomainPatterns(topic: string): DomainPatternRule[] {
  const lower = topic.toLowerCase();
  return DOMAIN_PATTERNS.filter((r) =>
    r.keywords.some((k) => lower.includes(k.toLowerCase()))
  );
}

function buildLenses(detected: BrainstormFocus[]): BrainstormLens[] {
  return DEVELOPMENT_LENSES.map((l) => ({
    ...l,
    relevant: detected.includes(l.focus),
  }));
}

function dedupeQuestions(qs: BrainstormQuestion[], limit = 10): BrainstormQuestion[] {
  const seen = new Set<string>();
  const out: BrainstormQuestion[] = [];
  for (const q of qs) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

function dedupeOptions(opts: BrainstormOption[], limit = 12): BrainstormOption[] {
  const seen = new Set<string>();
  const out: BrainstormOption[] = [];
  for (const o of opts) {
    if (seen.has(o.name)) continue;
    seen.add(o.name);
    out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}

function rankOptions(
  options: BrainstormOption[],
  answers?: BrainstormAnswers,
  stacks?: ReturnType<typeof detectStacksFromText>
): BrainstormOption[] {
  return [...options].sort((a, b) => {
    let sa = 0;
    let sb = 0;
    if (answers?.scale === "mvp") {
      if (a.complexity === "low") sa += 3;
      if (b.complexity === "low") sb += 3;
      if (a.complexity === "high") sa -= 2;
      if (b.complexity === "high") sb -= 2;
    }
    if (answers?.phase === "discovery" && a.focus === "planning") sa += 2;
    if (answers?.phase === "design" && (a.focus === "ux" || a.focus === "visual_design")) sa += 2;
    if (answers?.phase === "build" && (a.focus === "database" || a.focus === "algorithm")) sa += 2;
    if (stacks?.backend && a.stack_hints.some((h) => stacks.backend?.includes(h))) sa += 1;
    if (stacks?.backend && b.stack_hints.some((h) => stacks.backend?.includes(h))) sb += 1;
    return sb - sa;
  });
}

function buildAgentInstructions(
  topic: string,
  lenses: BrainstormLens[],
  options: BrainstormOption[]
): string {
  const relevantLenses = lenses.filter((l) => l.relevant).map((l) => l.label_ko).join(" → ");

  return [
    "# Full-lifecycle brainstorm facilitator",
    "",
    `Topic: ${topic}`,
    "",
    "## Your role",
    "You are a **development brainstorm partner** — not only DB/algorithms.",
    "Cover every relevant lens: 기획, UX, 디자인, 도메인, 아키텍처, DB, 알고리즘, API, 보안, 성능, 테스트, DevOps, 관측, 문서, 협업.",
    "",
    "## How to run the session",
    "1. Show **development_lenses** — ask which areas user wants to go deep today.",
    "2. Walk lenses in order (or user priority):",
    "   **기획** (목표·MVP·지표) → **UX/디자인** (플로우·화면) → **도메인/아키텍처** → **구현** (DB·알고리즘·API) → **품질** (보안·테스트) → **운영** (배포·관측) → **문서**",
    "3. One **clarifying_question** at a time; adapt options to answers.",
    "4. Cite **wiki_citations** for domain rules — never invent BC facts.",
    "5. Present **options** as menu with pros/cons — user picks or mixes.",
    "6. On confirmation → `file_back` to wiki; sketches (ERD, flow, wireframe) in markdown.",
    "",
    `Suggested lens order for this topic: ${relevantLenses || "전체 순회"}`,
    "",
    "## Deliverables per lens",
    "- planning: user stories, MVP cut, success metrics",
    "- ux: happy path, error states, device notes",
    "- visual_design: component list, design system choice",
    "- domain: BC map, aggregates, events",
    "- architecture: modules, deployment",
    "- database: tables, indexes, consistency",
    "- algorithm: concurrency, idempotency, patterns",
    "- security: threat checklist, authz",
    "- testing: pyramid, critical e2e paths",
    "- devops/observability: CI, alerts",
    "",
    `Options on the table (${options.length}): ${options.slice(0, 8).map((o) => `[${o.focus}] ${o.name}`).join("; ")}`,
  ].join("\n");
}

function buildMarkdown(
  result: Omit<BrainstormResult, "markdown" | "agent_instructions">
): string {
  const lines = [
    `# Development brainstorm — ${result.topic}`,
    "",
    "## Lenses (전체 개발 관점)",
    ...result.development_lenses.map(
      (l) => `- ${l.relevant ? "●" : "○"} **${l.label_ko}** (${l.focus}): ${l.when}`
    ),
    "",
    `Focus detected: ${result.detected_focus.join(", ")}`,
    "",
    "## Wiki context",
    result.context_excerpt.slice(0, 2000),
    "",
    "## Questions",
    ...result.clarifying_questions.map(
      (q) => `### [${q.focus}] ${q.id}\n${q.question}\n_${q.why}_`
    ),
    "",
    "## Options by area",
  ];

  const byFocus = new Map<BrainstormFocus, BrainstormOption[]>();
  for (const o of result.options) {
    const list = byFocus.get(o.focus) || [];
    list.push(o);
    byFocus.set(o.focus, list);
  }
  for (const [focus, opts] of byFocus) {
    lines.push(`### ${focus}`);
    for (const o of opts) {
      lines.push(`- **${o.name}** (${o.complexity}): ${o.approach}`);
      lines.push(`  - Pros: ${o.pros.join("; ")}`);
      lines.push(`  - Cons: ${o.cons.join("; ")}`);
    }
    lines.push("");
  }

  lines.push("## Draft recommendation");
  lines.push(`**Primary:** ${result.recommendation.primary}`);
  lines.push(result.recommendation.rationale);

  return lines.join("\n");
}

export async function brainstormDesign(
  vault: ObsidianVault,
  search: SemanticSearch,
  topic: string,
  opts?: {
    project_root?: string;
    focus?: BrainstormFocus[];
    answers?: BrainstormAnswers;
    skip_questions?: boolean;
    write_docs?: boolean;
  }
): Promise<BrainstormResult> {
  const root = opts?.project_root || resolveProjectRoot();
  const detectedFocus = detectFocusFromTopic(topic, opts?.focus);
  const lenses = buildLenses(detectedFocus);
  const stacks = detectStacksFromText(topic);
  const { profile } = await loadDomainProfile(vault, root);
  if (!stacks.backend && profile.stack?.backend) stacks.backend = profile.stack.backend;

  const domainRules = matchDomainPatterns(topic);
  const focusPlaybooks = collectFocusPlaybooks(detectedFocus);

  const questions = dedupeQuestions([
    ...domainRules.flatMap((r) => r.questions),
    ...focusPlaybooks.flatMap((p) => p.questions),
    ...SCALE_QUESTIONS,
  ]);

  if (!opts?.skip_questions && !opts?.answers?.scale && !opts?.answers?.phase) {
    return {
      status: "questions",
      topic,
      detected_focus: detectedFocus,
      development_lenses: lenses,
      detected_stacks: stacks,
      wiki_citations: [],
      context_excerpt: "",
      clarifying_questions: questions,
      options: [],
      recommendation: { primary: "", rationale: "", alternatives: [], risks: [] },
      agent_instructions: buildAgentInstructions(topic, lenses, []),
      markdown: [
        "# Brainstorm — discovery",
        "",
        "Full lifecycle: 기획·UX·디자인·도메인·DB·알고리즘·보안·테스트·DevOps…",
        "",
        ...questions.map((q) => `## [${q.focus}] ${q.id}\n${q.question}`),
      ].join("\n"),
    };
  }

  const pack = await buildDomainContextPack(vault, search, topic, {
    project_root: root,
    extra_queries: [
      ...detectedFocus,
      "bounded context",
      "기획",
      "ux",
      ...domainRules.flatMap((r) => r.keywords),
    ],
  });

  const wikiCitations = pack.citations.map((c) => c.path);
  const contextExcerpt = pack.pages.map((p) => `### ${p.title}\n${p.excerpt}`).join("\n\n");

  let options: BrainstormOption[] = [
    ...domainRules.flatMap((r) =>
      r.options.map((o) => ({
        ...o,
        wiki_citations: wikiCitations.filter((c) =>
          r.keywords.some((k) => c.toLowerCase().includes(k.toLowerCase()))
        ),
      }))
    ),
    ...focusPlaybooks.flatMap((p) =>
      p.options.map((o) => ({ ...o, wiki_citations: wikiCitations }))
    ),
  ];

  if (options.length < 4) {
    options.push(
      {
        name: "Wiki-driven full lifecycle",
        focus: "planning",
        approach: "wiki BC + lenses 순회하며 기획→디자인→구현 결정",
        pros: ["도메인 정합", "누락 방지"],
        cons: ["wiki 품질 의존"],
        when_to_use: "aio-mcp 프로젝트",
        complexity: "low",
        wiki_citations: wikiCitations,
        stack_hints: [],
      },
      {
        name: "Walking skeleton release",
        focus: "planning",
        approach: "E2E 한 줄 먼저, UI/DB는 최소",
        pros: ["빠른 검증"],
        cons: ["UX 빚"],
        when_to_use: "MVP discovery",
        complexity: "low",
        wiki_citations: wikiCitations,
        stack_hints: [],
      }
    );
  }

  options = rankOptions(dedupeOptions(options), opts?.answers, stacks);
  const primary = options[0];

  const recommendation = {
    primary: primary.name,
    rationale: [
      `Phase=${opts?.answers?.phase || "?"}, scale=${opts?.answers?.scale || "?"}.`,
      `Lenses: ${detectedFocus.join(", ")}.`,
      primary.when_to_use,
      wikiCitations.length ? `Wiki: ${wikiCitations.slice(0, 3).join(", ")}` : "Expand wiki for richer brainstorm.",
    ].join(" "),
    alternatives: options.slice(1, 5).map((o) => o.name),
    risks: [
      ...primary.cons.slice(0, 2),
      ...(opts?.answers?.scale === "mvp" && primary.complexity === "high"
        ? ["Over-engineering for MVP"]
        : []),
    ],
  };

  const partial = {
    status: "brief" as const,
    topic,
    detected_focus: detectedFocus,
    development_lenses: lenses,
    detected_stacks: stacks,
    wiki_citations: wikiCitations,
    context_excerpt: contextExcerpt,
    clarifying_questions: questions.slice(0, 8),
    options,
    recommendation,
  };

  const agent_instructions = buildAgentInstructions(topic, lenses, options);
  const markdown = buildMarkdown(partial);

  let docs_written: string[] | undefined;
  if (opts?.write_docs !== false) {
    const docsDir = path.join(root, "docs", "brainstorm");
    await fs.mkdir(docsDir, { recursive: true });
    const slug = topic.replace(/[^\w가-힣]+/g, "-").slice(0, 60);
    const mdPath = path.join(docsDir, `${slug || "session"}.md`);
    await fs.writeFile(mdPath, markdown + "\n\n---\n\n" + agent_instructions, "utf-8");
    docs_written = [mdPath];
  }

  return { ...partial, agent_instructions, markdown, docs_written };
}
