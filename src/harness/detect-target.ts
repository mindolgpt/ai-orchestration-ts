import * as fs from "fs/promises";
import * as path from "path";
import { HarnessTarget } from "@/harness/types";

export type HarnessTargetSource = "explicit" | "env" | "project" | "fallback";

export interface HarnessTargetDetection {
  target: HarnessTarget;
  source: HarnessTargetSource;
  hint?: string;
}

/** Per-target harness artifacts (excluding shared: AGENTS.md, .aio/*) */
export const HARNESS_FILES_BY_TARGET: Record<
  Exclude<HarnessTarget, "all">,
  Array<{ rel: string; label: string }>
> = {
  cursor: [
    { rel: ".cursor/rules/aio-domain-harness.mdc", label: "Cursor rule" },
    { rel: ".cursor/hooks.json", label: "Cursor hooks" },
    { rel: ".cursor/hooks/aio-session-start.mjs", label: "Cursor sessionStart hook" },
    { rel: ".cursor/hooks/aio-before-prompt.mjs", label: "Cursor beforeSubmitPrompt hook" },
    { rel: ".cursor/mcp.json", label: "Cursor MCP config" },
  ],
  claude: [
    { rel: "CLAUDE.md", label: "Claude Code instructions" },
    { rel: ".claude/settings.json", label: "Claude hooks config" },
    { rel: ".claude/hooks/aio-session-start.mjs", label: "Claude SessionStart hook" },
    { rel: ".claude/hooks/aio-before-prompt.mjs", label: "Claude UserPromptSubmit hook" },
    { rel: ".mcp.json", label: "Claude MCP config" },
  ],
  opencode: [
    { rel: "opencode.json", label: "OpenCode MCP + instructions" },
    { rel: ".opencode/plugins/aio-harness.mjs", label: "OpenCode harness plugin" },
  ],
  codex: [
    { rel: ".codex/mcp.toml", label: "Codex MCP config" },
    { rel: ".codex/hooks.json", label: "Codex hooks" },
    { rel: ".codex/hooks/aio-session-start.mjs", label: "Codex SessionStart hook" },
    { rel: ".codex/hooks/aio-before-prompt.mjs", label: "Codex UserPromptSubmit hook" },
  ],
  windsurf: [
    { rel: ".windsurf/rules/aio-domain-harness.md", label: "Windsurf rule" },
    { rel: ".windsurf/hooks.json", label: "Windsurf Cascade hooks" },
    { rel: ".windsurf/hooks/aio-before-prompt.mjs", label: "Windsurf pre_user_prompt hook" },
    { rel: ".windsurf/mcp_config.json", label: "Windsurf MCP config" },
  ],
  continue: [
    { rel: ".continue/rules/aio-domain-harness.md", label: "Continue rule" },
    { rel: ".continue/settings.json", label: "Continue CLI hooks" },
    { rel: ".continue/hooks/aio-session-start.mjs", label: "Continue SessionStart hook" },
    { rel: ".continue/hooks/aio-before-prompt.mjs", label: "Continue UserPromptSubmit hook" },
    { rel: ".continue/aio-mcp.yaml", label: "Continue MCP reference" },
  ],
};

const ALL_TARGETS: Array<Exclude<HarnessTarget, "all">> = [
  "cursor",
  "claude",
  "opencode",
  "codex",
  "windsurf",
  "continue",
];

function isHarnessTarget(v: string): v is Exclude<HarnessTarget, "all"> {
  return (ALL_TARGETS as string[]).includes(v);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fileHasAioMcp(projectRoot: string, rel: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(projectRoot, rel), "utf-8");
    return /aio-mcp|@mindol1004\/aio-mcp/i.test(raw);
  } catch {
    return false;
  }
}

/** Detect active AI tool from environment variables */
export function detectHarnessTargetFromEnv(): HarnessTargetDetection | null {
  const explicit = process.env.AIO_HARNESS_TARGET?.trim().toLowerCase();
  if (explicit && isHarnessTarget(explicit)) {
    return { target: explicit, source: "explicit" };
  }

  if (
    process.env.CURSOR_PROJECT_DIR ||
    process.env.CURSOR_TRACE_ID ||
    process.env.CURSOR_AGENT
  ) {
    return { target: "cursor", source: "env", hint: "CURSOR_* env detected" };
  }

  if (process.env.CLAUDE_CODE || process.env.CLAUDECODE || process.env.CLAUDE_SESSION) {
    return { target: "claude", source: "env", hint: "CLAUDE_* env detected" };
  }

  if (process.env.OPENCODE || process.env.OPENCODE_CONFIG) {
    return { target: "opencode", source: "env", hint: "OPENCODE env detected" };
  }

  if (process.env.CODEX_HOME || process.env.CODEX_CLI) {
    return { target: "codex", source: "env", hint: "CODEX env detected" };
  }

  if (process.env.WINDSURF || process.env.WINDSURF_PROJECT) {
    return { target: "windsurf", source: "env", hint: "WINDSURF env detected" };
  }

  if (process.env.CONTINUE_GLOBAL_DIR || process.env.CONTINUE_CONFIG) {
    return { target: "continue", source: "env", hint: "CONTINUE env detected" };
  }

  return null;
}

/** Infer tool from existing harness files in project */
export async function detectHarnessTargetFromProject(
  projectRoot: string
): Promise<HarnessTargetDetection | null> {
  const scores: Partial<Record<Exclude<HarnessTarget, "all">, number>> = {};

  for (const target of ALL_TARGETS) {
    let score = 0;
    for (const f of HARNESS_FILES_BY_TARGET[target]) {
      if (await pathExists(path.join(projectRoot, f.rel))) score++;
    }
    if (score > 0) scores[target] = score;
  }

  // MCP aio markers boost
  if (await fileHasAioMcp(projectRoot, ".cursor/mcp.json")) {
    scores.cursor = (scores.cursor || 0) + 3;
  }
  if (await fileHasAioMcp(projectRoot, ".mcp.json")) {
    scores.claude = (scores.claude || 0) + 2;
  }
  if (await fileHasAioMcp(projectRoot, "opencode.json")) {
    scores.opencode = (scores.opencode || 0) + 2;
  }
  if (await pathExists(path.join(projectRoot, ".codex", "mcp.toml"))) {
    scores.codex = (scores.codex || 0) + 2;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] === 0) return null;

  const [target] = ranked[0];
  if (!isHarnessTarget(target)) return null;

  return {
    target,
    source: "project",
    hint: `Project files match ${target} (score ${ranked[0][1]})`,
  };
}

export async function detectHarnessTarget(projectRoot?: string): Promise<HarnessTargetDetection> {
  const fromEnv = detectHarnessTargetFromEnv();
  if (fromEnv) return fromEnv;

  if (projectRoot) {
    const fromProject = await detectHarnessTargetFromProject(projectRoot);
    if (fromProject) return fromProject;
  }

  return {
    target: "cursor",
    source: "fallback",
    hint: "No tool detected — defaulting to cursor. Set AIO_HARNESS_TARGET or use targets:['all']",
  };
}

export function resolveTargets(
  targets?: HarnessTarget[],
  projectRoot?: string
): HarnessTarget[] {
  if (targets?.includes("all")) {
    return [...ALL_TARGETS];
  }
  if (targets?.length) {
    return targets.filter((t): t is HarnessTarget => t !== "all");
  }
  // Sync fallback when called without projectRoot (bootstrap always passes root async path)
  const fromEnv = detectHarnessTargetFromEnv();
  if (fromEnv) return [fromEnv.target];
  return ["cursor"];
}

export async function resolveTargetsAsync(
  targets?: HarnessTarget[],
  projectRoot?: string
): Promise<{ targets: HarnessTarget[]; detection: HarnessTargetDetection }> {
  if (targets?.includes("all")) {
    return {
      targets: [...ALL_TARGETS],
      detection: { target: "cursor", source: "explicit", hint: "targets=all" },
    };
  }
  if (targets?.length) {
    const t = targets.filter((x): x is HarnessTarget => x !== "all");
    return {
      targets: t,
      detection: { target: t[0], source: "explicit", hint: `targets=${t.join(",")}` },
    };
  }
  const detection = await detectHarnessTarget(projectRoot);
  return { targets: [detection.target], detection };
}

/** Files belonging to other tools (for doctor cleanup hints) */
export async function findForeignHarnessFiles(
  projectRoot: string,
  activeTarget: Exclude<HarnessTarget, "all">
): Promise<Array<{ target: HarnessTarget; rel: string; label: string }>> {
  const foreign: Array<{ target: HarnessTarget; rel: string; label: string }> = [];
  for (const target of ALL_TARGETS) {
    if (target === activeTarget) continue;
    for (const f of HARNESS_FILES_BY_TARGET[target]) {
      if (await pathExists(path.join(projectRoot, f.rel))) {
        foreign.push({ target, ...f });
      }
    }
  }
  return foreign;
}
