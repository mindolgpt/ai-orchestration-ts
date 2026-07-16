import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ObsidianVault } from "@/knowledge/vault";
import { SemanticSearch } from "@/knowledge/search";
import { bootstrapHarness } from "@/harness/bootstrap";
import { buildDomainContextPack, cacheContextPack, contextPackToMarkdown } from "@/harness/context-pack";
import { runDomainLoop } from "@/harness/loop";
import { loadDomainProfile, saveDomainProfile } from "@/harness/profile";
import { getEventLog } from "@/observability/events";
import { resolveProjectRoot } from "@/knowledge/paths";
import { HarnessTarget } from "@/harness/types";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerHarnessTools(
  server: McpServer,
  vault: ObsidianVault,
  search: SemanticSearch,
  projectRoot?: string
): void {
  const root = projectRoot || resolveProjectRoot();
  server.registerTool(
    "bootstrap_harness",
    {
      description:
        "Generate cross-tool domain harness: AGENTS.md, Cursor rules+hooks, Claude/OpenCode/Codex MCP configs from wiki domain profile. Run once per project (or after profile change).",
      inputSchema: z.object({
        targets: z
          .array(
            z.enum(["cursor", "claude", "opencode", "codex", "windsurf", "continue", "all"])
          )
          .optional(),
        force: z.boolean().optional(),
        domain: z.string().optional(),
        description: z.string().optional(),
        backend: z.string().optional(),
        frontend: z.string().optional(),
      }),
    },
    async (args) => {
      const result = await bootstrapHarness(vault, {
        targets: (args.targets as HarnessTarget[]) || ["all"],
        force: args.force,
        profile: {
          ...(args.domain ? { domain: args.domain } : {}),
          ...(args.description ? { description: args.description } : {}),
          stack: {
            ...(args.backend ? { backend: args.backend } : {}),
            ...(args.frontend ? { frontend: args.frontend } : {}),
          },
        },
      });
      await getEventLog().emit("harness.bootstrap", {
        targets: result.targets,
        files: result.files.length,
      });
      return json(result);
    }
  );

  server.registerTool(
    "bootstrap_domain",
    {
      description:
        "Build domain context pack from wiki for a task (RAG + overview pages + harness prompt). Caches to .aio/harness-context.json for hooks.",
      inputSchema: z.object({
        task: z.string(),
        top_k: z.number().optional(),
        extra_queries: z.array(z.string()).optional(),
        format: z.enum(["json", "markdown"]).optional(),
      }),
    },
    async (args) => {
      const pack = await buildDomainContextPack(vault, search, args.task, {
        top_k: args.top_k,
        extra_queries: args.extra_queries,
        project_root: root,
      });
      const cachePath = await cacheContextPack(pack);
      await getEventLog().emit("harness.domain", { task: args.task.slice(0, 80), pages: pack.pages.length });
      const body =
        args.format === "markdown"
          ? { markdown: contextPackToMarkdown(pack), cache_path: cachePath }
          : { ...pack, cache_path: cachePath };
      return json(body);
    }
  );

  server.registerTool(
    "run_domain_loop",
    {
      description:
        "Full domain harness loop brief: bootstrap_domain + plan stub + agent instructions for implement→verify→file_back.",
      inputSchema: z.object({
        task: z.string(),
        top_k: z.number().optional(),
        extra_queries: z.array(z.string()).optional(),
        include_plan: z.boolean().optional(),
      }),
    },
    async (args) => {
      const result = await runDomainLoop(vault, search, args.task, {
        top_k: args.top_k,
        extra_queries: args.extra_queries,
        include_plan: args.include_plan,
        project_root: root,
      });
      await getEventLog().emit("harness.loop", { task: args.task.slice(0, 80) });
      return json(result);
    }
  );

  server.registerTool(
    "get_domain_profile",
    {
      description: "Read .aio/domain-profile.yaml (or infer from wiki index)",
    },
    async () => {
      const loaded = await loadDomainProfile(vault);
      return json(loaded);
    }
  );

  server.registerTool(
    "save_domain_profile",
    {
      description: "Save domain profile to .aio/domain-profile.yaml",
      inputSchema: z.object({
        name: z.string().optional(),
        domain: z.string(),
        description: z.string(),
        backend: z.string().optional(),
        frontend: z.string().optional(),
        overview_pages: z.array(z.string()).optional(),
      }),
    },
    async (args) => {
      const { profile } = await loadDomainProfile(vault);
      const next = {
        ...profile,
        name: args.name || profile.name,
        domain: args.domain,
        description: args.description,
        stack: {
          ...profile.stack,
          ...(args.backend ? { backend: args.backend } : {}),
          ...(args.frontend ? { frontend: args.frontend } : {}),
        },
        wiki: {
          ...profile.wiki,
          ...(args.overview_pages ? { overview_pages: args.overview_pages } : {}),
        },
      };
      const path = await saveDomainProfile(next);
      return json({ saved: true, path, profile: next });
    }
  );
}
