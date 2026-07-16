import * as fs from "fs/promises";
import * as path from "path";
import yaml from "js-yaml";
import { ObsidianVault } from "@/knowledge/vault";
import { resolveProjectRoot } from "@/knowledge/paths";
import { loadDomainProfile, saveDomainProfile, inferOverviewPagesFromWiki } from "@/harness/profile";
import {
  projectAgentsMd,
  cursorRuleMdc,
  claudeMd,
  cursorHooksJson,
  cursorSessionStartHook,
  cursorBeforePromptHook,
  claudeSettingsJson,
  claudeSessionStartHook,
  claudeBeforePromptHook,
  codexHooksJson,
  windsurfRuleMd,
  windsurfHooksJson,
  windsurfBeforePromptHook,
  continueRuleMd,
  continueSettingsJson,
  opencodeHarnessPlugin,
  mcpJsonCursor,
  mcpJsonClaude,
  opencodeJson,
  codexToml,
  windsurfMcpJson,
  continueMcpYaml,
  mergeJsonFile,
} from "@/harness/templates";
import { resolveTargetsAsync } from "@/harness/detect-target";
import {
  BootstrapFileResult,
  BootstrapHarnessResult,
  DomainProfile,
  HarnessTarget,
} from "@/harness/types";

export interface BootstrapHarnessOptions {
  projectRoot?: string;
  targets?: HarnessTarget[];
  profile?: Partial<DomainProfile>;
  force?: boolean;
  save_profile?: boolean;
}

async function writeFile(
  abs: string,
  content: string,
  force: boolean,
  target: HarnessTarget | "shared"
): Promise<BootstrapFileResult> {
  try {
    await fs.access(abs);
    if (!force) return { path: abs, action: "skipped", target };
  } catch {
    /* create */
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  let action: BootstrapFileResult["action"] = "created";
  try {
    await fs.access(abs);
    action = force ? "updated" : "created";
  } catch {
    action = "created";
  }
  return { path: abs, action, target };
}

export async function bootstrapHarness(
  vault: ObsidianVault,
  opts: BootstrapHarnessOptions = {}
): Promise<BootstrapHarnessResult> {
  const projectRoot = path.resolve(opts.projectRoot || resolveProjectRoot());
  const { targets, detection } = await resolveTargetsAsync(opts.targets, projectRoot);
  const force = opts.force === true;
  const files: BootstrapFileResult[] = [];

  let { profile } = await loadDomainProfile(vault, projectRoot);
  if (opts.profile) {
    profile = {
      ...profile,
      ...opts.profile,
      stack: { ...profile.stack, ...opts.profile.stack },
      wiki: { ...profile.wiki, ...opts.profile.wiki },
      loop: { ...profile.loop, ...opts.profile.loop },
      harness: { ...profile.harness, ...opts.profile.harness },
    };
  }
  if (!profile.wiki?.overview_pages?.length) {
    profile.wiki = {
      ...profile.wiki,
      overview_pages: await inferOverviewPagesFromWiki(vault),
    };
  }

  let profilePath = "";
  if (opts.save_profile !== false) {
    profilePath = await saveDomainProfile(profile, projectRoot);
    files.push({ path: profilePath, action: "updated", target: "shared" });
  }

  // Shared AGENTS.md
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  const agentsResult = await writeFile(
    agentsPath,
    projectAgentsMd(profile),
    force,
    "shared"
  );
  files.push({ ...agentsResult, target: "shared" });

  const posixRoot = projectRoot.replace(/\\/g, "/");

  if (targets.includes("cursor")) {
    files.push(
      await writeFile(
        path.join(projectRoot, ".cursor", "rules", "aio-domain-harness.mdc"),
        cursorRuleMdc(profile),
        force,
        "cursor"
      )
    );
    const hooksDir = path.join(projectRoot, ".cursor", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    files.push(
      await writeFile(
        path.join(projectRoot, ".cursor", "hooks.json"),
        cursorHooksJson(),
        force,
        "cursor"
      )
    );
    files.push(
      await writeFile(
        path.join(hooksDir, "aio-session-start.mjs"),
        cursorSessionStartHook(),
        force,
        "cursor"
      )
    );
    files.push(
      await writeFile(
        path.join(hooksDir, "aio-before-prompt.mjs"),
        cursorBeforePromptHook(),
        force,
        "cursor"
      )
    );
    const mcpPath = path.join(projectRoot, ".cursor", "mcp.json");
    const mcpAction = await mergeJsonFile(
      mcpPath,
      JSON.parse(mcpJsonCursor(posixRoot)) as Record<string, unknown>,
      "mcpServers"
    );
    files.push({ path: mcpPath, action: mcpAction, target: "cursor" });
  }

  if (targets.includes("claude")) {
    files.push(
      await writeFile(path.join(projectRoot, "CLAUDE.md"), claudeMd(profile), force, "claude")
    );
    const claudeHooksDir = path.join(projectRoot, ".claude", "hooks");
    await fs.mkdir(claudeHooksDir, { recursive: true });
    files.push(
      await writeFile(
        path.join(projectRoot, ".claude", "settings.json"),
        claudeSettingsJson(),
        force,
        "claude"
      )
    );
    files.push(
      await writeFile(
        path.join(claudeHooksDir, "aio-session-start.mjs"),
        claudeSessionStartHook(),
        force,
        "claude"
      )
    );
    files.push(
      await writeFile(
        path.join(claudeHooksDir, "aio-before-prompt.mjs"),
        claudeBeforePromptHook(),
        force,
        "claude"
      )
    );
    const mcpPath = path.join(projectRoot, ".mcp.json");
    const mcpAction = await mergeJsonFile(
      mcpPath,
      JSON.parse(mcpJsonClaude(posixRoot)) as Record<string, unknown>,
      "mcpServers"
    );
    files.push({ path: mcpPath, action: mcpAction, target: "claude" });
  }

  if (targets.includes("opencode")) {
    const ocPath = path.join(projectRoot, "opencode.json");
    const ocAction = await mergeJsonFile(
      ocPath,
      JSON.parse(opencodeJson(posixRoot)) as Record<string, unknown>,
      "mcp"
    );
    files.push({ path: ocPath, action: ocAction, target: "opencode" });
    try {
      const raw = await fs.readFile(ocPath, "utf-8");
      const existing = JSON.parse(raw) as Record<string, unknown>;
      const instructions = existing.instructions as string[] | undefined;
      if (!instructions?.includes("AGENTS.md")) {
        existing.instructions = [...(instructions || []), "AGENTS.md"];
        await fs.writeFile(ocPath, JSON.stringify(existing, null, 2), "utf-8");
      }
    } catch {
      /* mergeJsonFile created file with instructions already */
    }
    files.push(
      await writeFile(
        path.join(projectRoot, ".opencode", "plugins", "aio-harness.mjs"),
        opencodeHarnessPlugin(),
        force,
        "opencode"
      )
    );
  }

  if (targets.includes("codex")) {
    const codexHooksDir = path.join(projectRoot, ".codex", "hooks");
    await fs.mkdir(codexHooksDir, { recursive: true });
    files.push(
      await writeFile(
        path.join(projectRoot, ".codex", "mcp.toml"),
        codexToml(posixRoot),
        force,
        "codex"
      )
    );
    files.push(
      await writeFile(
        path.join(projectRoot, ".codex", "hooks.json"),
        codexHooksJson(),
        force,
        "codex"
      )
    );
    files.push(
      await writeFile(
        path.join(codexHooksDir, "aio-session-start.mjs"),
        claudeSessionStartHook(),
        force,
        "codex"
      )
    );
    files.push(
      await writeFile(
        path.join(codexHooksDir, "aio-before-prompt.mjs"),
        claudeBeforePromptHook(),
        force,
        "codex"
      )
    );
    files.push(
      await writeFile(
        path.join(projectRoot, "AGENTS.md"),
        projectAgentsMd(profile),
        true,
        "codex"
      )
    );
  }

  if (targets.includes("windsurf")) {
    const wsHooksDir = path.join(projectRoot, ".windsurf", "hooks");
    await fs.mkdir(wsHooksDir, { recursive: true });
    files.push(
      await writeFile(
        path.join(projectRoot, ".windsurf", "rules", "aio-domain-harness.md"),
        windsurfRuleMd(profile),
        force,
        "windsurf"
      )
    );
    files.push(
      await writeFile(
        path.join(projectRoot, ".windsurf", "hooks.json"),
        windsurfHooksJson(),
        force,
        "windsurf"
      )
    );
    files.push(
      await writeFile(
        path.join(wsHooksDir, "aio-before-prompt.mjs"),
        windsurfBeforePromptHook(),
        force,
        "windsurf"
      )
    );
    files.push(
      await writeFile(
        path.join(projectRoot, ".windsurf", "mcp_config.json"),
        windsurfMcpJson(posixRoot),
        force,
        "windsurf"
      )
    );
  }

  if (targets.includes("continue")) {
    const contHooksDir = path.join(projectRoot, ".continue", "hooks");
    await fs.mkdir(contHooksDir, { recursive: true });
    files.push(
      await writeFile(
        path.join(projectRoot, ".continue", "rules", "aio-domain-harness.md"),
        continueRuleMd(profile),
        force,
        "continue"
      )
    );
    files.push(
      await writeFile(
        path.join(projectRoot, ".continue", "settings.json"),
        continueSettingsJson(),
        force,
        "continue"
      )
    );
    files.push(
      await writeFile(
        path.join(contHooksDir, "aio-session-start.mjs"),
        claudeSessionStartHook(),
        force,
        "continue"
      )
    );
    files.push(
      await writeFile(
        path.join(contHooksDir, "aio-before-prompt.mjs"),
        claudeBeforePromptHook(),
        force,
        "continue"
      )
    );
    files.push(
      await writeFile(
        path.join(projectRoot, ".continue", "aio-mcp.yaml"),
        continueMcpYaml(posixRoot),
        force,
        "continue"
      )
    );
  }

  // Harness readme snippet
  const readmeSnippet = path.join(projectRoot, ".aio", "HARNESS.md");
  files.push(
    await writeFile(
      readmeSnippet,
      [
        "# aio-mcp Domain Harness",
        "",
        `Generated: ${new Date().toISOString()}`,
        `Targets: ${targets.join(", ")}`,
        "",
        "## Quick start",
        "",
        "1. MCP connected with `AIO_PROJECT_ROOT` = this project",
        "2. Say **하네스 구성해줘** / **아키텍처 설계해줘** or call `aio_prompt` with execute:true",
        "3. `seed_stack_playbooks` once for stack wiki under vault/wiki/stacks/",
        "4. `bootstrap_domain` with your task",
        "5. `run_domain_loop` for full agent brief",
        "",
        "Profile: `.aio/domain-profile.yaml`",
        "Cached context: `.aio/harness-context.json`",
        "",
      ].join("\n"),
      force,
      "shared"
    )
  );

  await fs.mkdir(path.join(projectRoot, ".aio"), { recursive: true });

  return {
    ok: true,
    project_root: projectRoot,
    vault_root: vault.rootPath,
    targets,
    target_detection: {
      target: detection.target,
      source: detection.source,
      hint: detection.hint,
    },
    files,
    profile_path: profilePath,
    next_steps: [
      "Restart MCP in your AI client (Cursor: reload MCP; Claude/Codex: restart session)",
      "Codex: trust project + review hooks via /hooks",
      "OpenCode: restart after .opencode/plugins/ is created",
      "For Cursor/Claude/Codex/Continue CLI: ensure hooks are enabled",
      "Natural language: say '하네스 구성해줘' (auto-detects your AI tool; use targets:['all'] for every client)",
      "Call seed_stack_playbooks once to populate vault/wiki/stacks/",
      "Call bootstrap_domain({ task: \"your feature\" }) before coding",
      "Edit .aio/domain-profile.yaml for stack/domain tweaks; re-run bootstrap_harness",
    ],
  };
}

export async function readDomainProfileYaml(projectRoot?: string): Promise<DomainProfile | null> {
  try {
    const raw = await fs.readFile(
      path.join(projectRoot || resolveProjectRoot(), ".aio", "domain-profile.yaml"),
      "utf-8"
    );
    return yaml.load(raw) as DomainProfile;
  } catch {
    return null;
  }
}
