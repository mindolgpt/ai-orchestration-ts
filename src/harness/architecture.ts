import * as fs from "fs/promises";
import * as path from "path";
import { ObsidianVault } from "@/knowledge/vault";
import { SemanticSearch } from "@/knowledge/search";
import { resolveProjectRoot } from "@/knowledge/paths";
import { buildDomainContextPack } from "@/harness/context-pack";
import { loadDomainProfile } from "@/harness/profile";
import { detectStacksFromText, findPlaybookByAlias, STACK_PLAYBOOKS } from "@/harness/stack-playbooks";

export interface ArchitectureAnswers {
  team_size?: string;
  deployment?: "monolith" | "microservices" | "modular-monolith" | "serverless" | "unknown";
  scale?: "mvp" | "growth" | "enterprise";
  auth_model?: string;
  data_stores?: string;
  frontend?: string;
  backend?: string;
  mobile?: string;
  notes?: string;
}

export interface ArchitectureQuestion {
  id: string;
  question: string;
  why: string;
  options?: string[];
}

export interface ArchitectureModule {
  name: string;
  type: "frontend" | "backend" | "shared" | "infra" | "mobile";
  bounded_context?: string;
  responsibilities: string[];
  wiki_citations: string[];
}

export interface ArchitectureDesignResult {
  status: "questions" | "draft";
  intent: string;
  detected_stacks: { frontend?: string; backend?: string; mobile?: string; api?: string };
  pending_questions: ArchitectureQuestion[];
  modules: ArchitectureModule[];
  layers: Record<string, string[]>;
  stack_playbook_citations: string[];
  domain_citations: string[];
  markdown: string;
  docs_written?: string[];
  architecture_json_path?: string;
  next_step: string;
}

const CORE_QUESTIONS: ArchitectureQuestion[] = [
  {
    id: "team_size",
    question: "팀 규모와 역할 분담은? (예: FE 2, BE 3, 단독)",
    why: "모듈 경계와 모놀리식/MSA 선택에 영향",
  },
  {
    id: "deployment",
    question: "배포 형태는? (modular-monolith / microservices / serverless)",
    why: "서비스 분리 수준 결정",
    options: ["modular-monolith", "microservices", "serverless", "monolith"],
  },
  {
    id: "scale",
    question: "초기 규모는? (MVP / growth / enterprise)",
    why: "과도한 분리 방지 vs 확장성",
    options: ["mvp", "growth", "enterprise"],
  },
  {
    id: "auth_model",
    question: "인증 방식은? (JWT, session, OAuth2, SSO)",
    why: "auth BC와 API gateway 설계",
  },
];

function missingQuestions(answers?: ArchitectureAnswers): ArchitectureQuestion[] {
  if (!answers) return CORE_QUESTIONS;
  const missing: ArchitectureQuestion[] = [];
  if (!answers.team_size) missing.push(CORE_QUESTIONS[0]);
  if (!answers.deployment || answers.deployment === "unknown") missing.push(CORE_QUESTIONS[1]);
  if (!answers.scale) missing.push(CORE_QUESTIONS[2]);
  if (!answers.auth_model) missing.push(CORE_QUESTIONS[3]);
  return missing;
}

function inferModulesFromWiki(
  domainPages: Array<{ title: string; path: string }>,
  stacks: { frontend?: string; backend?: string; mobile?: string }
): ArchitectureModule[] {
  const modules: ArchitectureModule[] = [];

  if (stacks.frontend) {
    modules.push({
      name: `${stacks.frontend}-app`,
      type: "frontend",
      responsibilities: [
        "UI routes/pages per feature",
        "API client layer (no domain rules in components)",
        `Follow [[stacks/${stacks.frontend}]] playbook`,
      ],
      wiki_citations: [`stacks/${stacks.frontend}`],
    });
  }

  if (stacks.mobile) {
    modules.push({
      name: `${stacks.mobile}-app`,
      type: "mobile",
      responsibilities: ["Mobile feature modules", `Follow [[stacks/${stacks.mobile}]]`],
      wiki_citations: [`stacks/${stacks.mobile}`],
    });
  }

  if (stacks.backend) {
    const bcKeywords = ["주문", "결제", "장바구니", "회원", "인증", "재고", "카탈로그", "배송", "검색", "order", "payment", "cart", "auth", "inventory", "catalog"];
    const seen = new Set<string>();

    for (const page of domainPages) {
      const hit = bcKeywords.find((k) => page.title.toLowerCase().includes(k.toLowerCase()) || page.path.toLowerCase().includes(k.toLowerCase()));
      if (!hit || seen.has(page.title)) continue;
      seen.add(page.title);
      const modName = page.path.replace(/^wiki\//, "").replace(/\.md$/, "").split("/").pop() || page.title;
      modules.push({
        name: `${modName}-module`,
        type: "backend",
        bounded_context: page.title,
        responsibilities: [
          `Implement ${page.title} bounded context`,
          "Application service + domain + infra layers",
          `Cite ${page.path}`,
        ],
        wiki_citations: [page.path],
      });
    }

    if (modules.filter((m) => m.type === "backend").length === 0) {
      modules.push({
        name: "api-core",
        type: "backend",
        responsibilities: ["Core API module", `Follow [[stacks/${stacks.backend}]]`],
        wiki_citations: [`stacks/${stacks.backend}`],
      });
    }
  }

  modules.push({
    name: "shared-contracts",
    type: "shared",
    responsibilities: ["DTO/OpenAPI schemas shared across BCs", "No cross-BC entity sharing"],
    wiki_citations: [],
  });

  return modules;
}

function buildArchitectureMarkdown(
  intent: string,
  stacks: ReturnType<typeof detectStacksFromText>,
  modules: ArchitectureModule[],
  answers?: ArchitectureAnswers,
  domainCitations?: string[]
): string {
  const lines = [
    `# Architecture — ${intent.slice(0, 80)}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Stack",
    "",
    `- Frontend: ${stacks.frontend || answers?.frontend || "TBD"}`,
    `- Backend: ${stacks.backend || answers?.backend || "TBD"}`,
    `- Mobile: ${stacks.mobile || answers?.mobile || "—"}`,
    `- Deployment: ${answers?.deployment || "TBD"}`,
    `- Scale: ${answers?.scale || "TBD"}`,
    "",
    "## Modules (bounded context mapping)",
    "",
  ];

  for (const m of modules) {
    lines.push(`### ${m.name} (${m.type})`);
    if (m.bounded_context) lines.push(`- Bounded context: **${m.bounded_context}**`);
    for (const r of m.responsibilities) lines.push(`- ${r}`);
    if (m.wiki_citations.length) lines.push(`- Citations: ${m.wiki_citations.map((c) => `[[${c}]]`).join(", ")}`);
    lines.push("");
  }

  if (domainCitations?.length) {
    lines.push("## Domain wiki references");
    for (const c of domainCitations) lines.push(`- [[${c}]]`);
    lines.push("");
  }

  lines.push("## Next steps");
  lines.push("1. Confirm Q&A answers with the user");
  lines.push("2. `plan_task` → module-by-module implementation DAG");
  lines.push("3. `file_back` this architecture into wiki when approved");

  return lines.join("\n");
}

export async function designArchitecture(
  vault: ObsidianVault,
  search: SemanticSearch,
  intent: string,
  opts?: {
    answers?: ArchitectureAnswers;
    frontend?: string;
    backend?: string;
    mobile?: string;
    project_root?: string;
    write_docs?: boolean;
    skip_questions?: boolean;
  }
): Promise<ArchitectureDesignResult> {
  const root = opts?.project_root || resolveProjectRoot();
  const detected = {
    ...detectStacksFromText(intent),
    ...(opts?.frontend ? { frontend: opts.frontend } : {}),
    ...(opts?.backend ? { backend: opts.backend } : {}),
    ...(opts?.mobile ? { mobile: opts.mobile } : {}),
  };

  const { profile } = await loadDomainProfile(vault, root);
  if (!detected.frontend && profile.stack?.frontend) detected.frontend = profile.stack.frontend;
  if (!detected.backend && profile.stack?.backend) detected.backend = profile.stack.backend;

  const pending = opts?.skip_questions ? [] : missingQuestions(opts?.answers);
  if (pending.length > 0 && !opts?.skip_questions) {
    return {
      status: "questions",
      intent,
      detected_stacks: detected,
      pending_questions: pending,
      modules: [],
      layers: {},
      stack_playbook_citations: [],
      domain_citations: [],
      markdown: [
        "# Architecture interview",
        "",
        "Answer these questions, then call `design_architecture` again with `answers`.",
        "",
        ...pending.map((q) => `## ${q.id}\n${q.question}\n_${q.why}_`),
      ].join("\n"),
      next_step: "Collect user answers and re-call design_architecture with answers object",
    };
  }

  const pack = await buildDomainContextPack(vault, search, intent, {
    project_root: root,
    extra_queries: [
      ...(detected.frontend ? [`stacks/${detected.frontend}`, detected.frontend] : []),
      ...(detected.backend ? [`stacks/${detected.backend}`, detected.backend] : []),
      "bounded context",
      "architecture",
    ],
  });

  const stackCitations: string[] = [];
  for (const key of ["frontend", "backend", "mobile"] as const) {
    const id = detected[key];
    if (id) stackCitations.push(`stacks/${id}`);
  }

  const domainCitations = pack.citations
    .filter((c) => !c.path.includes("/stacks/"))
    .map((c) => c.path);

  const modules = inferModulesFromWiki(
    pack.pages.map((p) => ({ title: p.title, path: p.path })),
    detected
  );

  const layers: Record<string, string[]> = {};
  if (detected.backend) {
    const pb = findPlaybookByAlias(detected.backend);
    if (pb?.content.includes("Layers")) {
      layers.backend = ["controller/handler", "application service", "domain", "infrastructure"];
    }
  }
  if (detected.frontend) {
    layers.frontend = ["pages/routes", "features", "entities/api-client", "shared/ui"];
  }

  const markdown = buildArchitectureMarkdown(intent, detected, modules, opts?.answers, domainCitations);

  let docs_written: string[] | undefined;
  let architecture_json_path: string | undefined;

  if (opts?.write_docs !== false) {
    const docsDir = path.join(root, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    const archMd = path.join(docsDir, "architecture.md");
    await fs.writeFile(archMd, markdown, "utf-8");
    docs_written = [archMd];

    const aioDir = path.join(root, ".aio");
    await fs.mkdir(aioDir, { recursive: true });
    architecture_json_path = path.join(aioDir, "architecture.json");
    await fs.writeFile(
      architecture_json_path,
      JSON.stringify(
        {
          intent,
          detected_stacks: detected,
          answers: opts?.answers,
          modules,
          layers,
          domain_citations: domainCitations,
          stack_citations: stackCitations,
          updated_at: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf-8"
    );
    docs_written.push(architecture_json_path);
  }

  return {
    status: "draft",
    intent,
    detected_stacks: detected,
    pending_questions: [],
    modules,
    layers,
    stack_playbook_citations: stackCitations,
    domain_citations: domainCitations,
    markdown,
    docs_written,
    architecture_json_path,
    next_step: "Review with user → confirm → plan_task per module → file_back to wiki",
  };
}

export async function listStackPlaybookIds(): Promise<string[]> {
  return STACK_PLAYBOOKS.map((p) => p.id);
}
