export type HarnessTarget =
  | "cursor"
  | "claude"
  | "opencode"
  | "codex"
  | "windsurf"
  | "continue"
  | "all";

export type LoopStep =
  | "bootstrap_domain"
  | "query_wiki"
  | "plan_task"
  | "execute_dag"
  | "implement"
  | "verify"
  | "file_back"
  | "lint_wiki";

export interface DomainProfile {
  name: string;
  domain: string;
  description: string;
  stack?: {
    backend?: string;
    frontend?: string;
    infra?: string;
  };
  wiki?: {
    overview_pages?: string[];
    default_top_k?: number;
    query_hints?: string[];
  };
  loop?: {
    steps?: LoopStep[];
    require_citations?: boolean;
    file_back_on_complete?: boolean;
  };
  harness?: {
    force_bootstrap_before_code?: boolean;
    suggested_mcp_tools?: string[];
  };
}

export const DEFAULT_DOMAIN_PROFILE: DomainProfile = {
  name: "default",
  domain: "general",
  description: "Domain-driven project using aio-mcp wiki harness",
  stack: {},
  wiki: {
    overview_pages: [],
    default_top_k: 5,
    query_hints: [],
  },
  loop: {
    steps: ["bootstrap_domain", "plan_task", "implement", "verify", "file_back"],
    require_citations: true,
    file_back_on_complete: true,
  },
  harness: {
    force_bootstrap_before_code: true,
    suggested_mcp_tools: [
      "bootstrap_domain",
      "query_wiki",
      "plan_task",
      "execute_dag",
      "file_back",
      "lint_wiki",
    ],
  },
};

export interface ContextPackPage {
  path: string;
  title: string;
  score?: number;
  excerpt: string;
}

export interface DomainContextPack {
  task: string;
  profile: DomainProfile;
  schema_excerpt: string;
  wiki_index_excerpt: string;
  pages: ContextPackPage[];
  citations: Array<{ path: string; title: string; score?: number }>;
  harness_prompt: string;
  loop_steps: LoopStep[];
  cached_at: string;
}

export interface BootstrapFileResult {
  path: string;
  action: "created" | "updated" | "skipped";
  target: HarnessTarget | "shared";
}

export interface BootstrapHarnessResult {
  ok: boolean;
  project_root: string;
  vault_root: string;
  targets: HarnessTarget[];
  files: BootstrapFileResult[];
  profile_path: string;
  next_steps: string[];
}

export interface DomainLoopResult {
  phase: string;
  context_pack: DomainContextPack;
  plan_stub?: {
    title: string;
    suggested_success_criteria: string[];
    suggested_constraints: string[];
  };
  agent_instructions: string;
}
