import { ObsidianVault } from "@/knowledge/vault";
import { SemanticSearch } from "@/knowledge/search";
import { MessageInbox } from "@/mcp/inbox";
import {
  ChildSession,
  closeSession,
  spawnSession,
  synthesizeResults,
} from "@/mcp/tools/session-tools";
import { DeepInterviewPlanner } from "@/orchestrator/planner";
import { BranchHunt } from "@/orchestrator/branch-hunt";
import { ApprovalGate } from "@/orchestrator/approval";
import { bootstrapHarness } from "@/harness/bootstrap";
import { buildDomainContextPack, cacheContextPack } from "@/harness/context-pack";
import { runDomainLoop } from "@/harness/loop";
import { loadDomainProfile, saveDomainProfile } from "@/harness/profile";
import { brainstormDesign } from "@/harness/brainstorm";
import { seedStackPlaybooks, seedPatternPlaybooks } from "@/harness/seed-stacks";
import { ALL_STACK_IDS } from "@/harness/stack-playbooks";
import { PromptRoute } from "@/harness/prompt-router";
import { HarnessTarget } from "@/harness/types";
import {
  fileBack,
  getWikiSchema,
  ingestRaw,
  ingestSource,
  lintWiki,
  queryWiki,
  updateWikiPage,
} from "@/knowledge/wiki-ops";
import { getEventLog } from "@/observability/events";
import { listWorktrees, removeWorktree } from "@/orchestrator/worktree";
import { createInbox } from "@/mcp/inbox";
import { runDoctor } from "@/doctor/check";
import { createEmbedder } from "@/knowledge/embedder";
import { resolveIndexDir, resolveProjectRoot, resolveVaultRoot } from "@/knowledge/paths";

export interface PromptExecutorDeps {
  vault: ObsidianVault;
  search: SemanticSearch;
  projectRoot: string;
  sessions: Map<string, ChildSession>;
  inbox: MessageInbox;
  maxSessions: number;
  dagResults: Map<string, unknown>;
  planner: DeepInterviewPlanner;
  branchHunt: BranchHunt;
  approval: ApprovalGate;
}

export interface ExecutePromptOptions {
  route: PromptRoute;
  message: string;
  execute?: boolean;
  /** Override / merge params */
  params?: Record<string, unknown>;
  harness?: {
    targets?: HarnessTarget[];
    force?: boolean;
    answers?: Record<string, unknown>;
  };
}

export interface ExecutePromptResult {
  tool: string;
  executed: boolean;
  result?: unknown;
  error?: string;
  suggested_params?: Record<string, unknown>;
  hint?: string;
}

export async function executePromptRoute(
  deps: PromptExecutorDeps,
  opts: ExecutePromptOptions
): Promise<ExecutePromptResult> {
  const { route, message } = opts;
  const p = { ...route.extracted_params, ...opts.params };

  if (route.tool === "unknown") {
    return {
      tool: "unknown",
      executed: false,
      hint: route.agent_hint,
    };
  }

  if (!opts.execute) {
    return {
      tool: route.tool,
      executed: false,
      suggested_params: p,
      hint: "Set execute:true to run, or call the tool directly with suggested_params.",
    };
  }

  try {
    const result = await dispatchTool(deps, route.tool, message, p, opts.harness);
    await getEventLog(deps.projectRoot).emit("prompt.execute", {
      tool: route.tool,
      score: route.score,
      keywords: route.matched_keywords.slice(0, 5),
    });
    return { tool: route.tool, executed: true, result };
  } catch (err) {
    return {
      tool: route.tool,
      executed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function dispatchTool(
  deps: PromptExecutorDeps,
  tool: string,
  message: string,
  p: Record<string, unknown>,
  harness?: ExecutePromptOptions["harness"]
): Promise<unknown> {
  const { vault, search, projectRoot, sessions, inbox, maxSessions, dagResults, planner, branchHunt, approval } =
    deps;

  switch (tool) {
    case "bootstrap_harness":
      return bootstrapHarness(vault, {
        projectRoot,
        targets: (harness?.targets as HarnessTarget[]) || ["all"],
        force: harness?.force,
        profile: {
          description: String(p.message || p.intent || message),
          stack: {
            frontend: detectStacksFromText(message).frontend,
            backend: detectStacksFromText(message).backend,
          },
        },
      });

    case "design_architecture":
      return designArchitecture(vault, search, String(p.intent || message), {
        project_root: projectRoot,
        answers: harness?.answers as import("@/harness/architecture").ArchitectureAnswers,
        frontend: detectStacksFromText(message).frontend,
        backend: detectStacksFromText(message).backend,
        mobile: detectStacksFromText(message).mobile,
      });

    case "brainstorm_design":
      return brainstormDesign(vault, search, String(p.topic || p.intent || message), {
        project_root: projectRoot,
        answers: p.answers as import("@/harness/brainstorm").BrainstormAnswers,
        skip_questions: p.skip_questions === true || !!harness?.answers,
      });

    case "seed_stack_playbooks":
      return {
        stacks: await seedStackPlaybooks(vault, search),
        patterns: await seedPatternPlaybooks(vault, search),
      };

    case "run_domain_loop":
      return runDomainLoop(vault, search, String(p.task || message), { project_root: projectRoot });

    case "bootstrap_domain": {
      const pack = await buildDomainContextPack(vault, search, String(p.task || message), {
        project_root: projectRoot,
      });
      const cachePath = await cacheContextPack(pack, projectRoot);
      return { ...pack, cache_path: cachePath };
    }

    case "get_domain_profile":
      return loadDomainProfile(vault, projectRoot);

    case "save_domain_profile": {
      const { profile } = await loadDomainProfile(vault, projectRoot);
      const next = {
        ...profile,
        description: String(p.content || p.title || message),
        domain: String(p.title || profile.domain),
      };
      const path = await saveDomainProfile(next, projectRoot);
      return { saved: true, path, profile: next };
    }

    case "list_stack_playbooks":
      return { count: ALL_STACK_IDS.length, stacks: ALL_STACK_IDS };

    case "get_wiki_schema":
      return getWikiSchema(vault);

    case "ingest_raw":
      return ingestRaw(vault, {
        title: String(p.title || "Untitled"),
        content: String(p.content || message),
      });

    case "ingest_source":
      return ingestSource(vault, search, {
        title: String(p.title || "Untitled"),
        content: String(p.content || message),
      });

    case "update_wiki_page":
      return updateWikiPage(vault, search, {
        title: String(p.title || "Untitled"),
        content: String(p.content || message),
      });

    case "query_wiki":
      return queryWiki(vault, search, String(p.query || message), Number(p.top_k) || 5);

    case "file_back":
      return fileBack(vault, search, {
        title: String(p.title || "Synthesis"),
        content: String(p.content || message),
        query: String(p.query || message),
      });

    case "lint_wiki":
      return lintWiki(vault, { deep: p.deep === true });

    case "spawn_session":
      return spawnSession(sessions, inbox, maxSessions, String(p.task || message), undefined, {
        worktree: p.worktree === true,
        projectRoot,
      });

    case "check_inbox":
      return {
        backend: inbox.backendName,
        messages: inbox.poll(
          p.session_id ? String(p.session_id) : undefined,
          p.status ? String(p.status) : undefined
        ),
      };

    case "list_sessions":
      return {
        running: Array.from(sessions.values()).filter((s) => s.status === "running").length,
        max_sessions: maxSessions,
        sessions: Array.from(sessions.values()).map((s) => ({
          id: s.id,
          status: s.status,
          task: s.task,
        })),
      };

    case "get_session": {
      const sid = String(p.session_id || "");
      const s = sessions.get(sid);
      if (!s) return { error: `Session ${sid} not found` };
      return { id: s.id, status: s.status, task: s.task, stdout_tail: s.stdout.slice(-1000) };
    }

    case "close_session":
      return closeSession(
        sessions,
        String(p.session_id || ""),
        p.kill !== false,
        p.remove_worktree === true
      );

    case "send_message": {
      const sid = String(p.session_id || "");
      const s = sessions.get(sid);
      if (!s) return { error: "session not found" };
      s.pendingMessages.push(String(p.message || message));
      return { queued: true };
    }

    case "report_result":
      inbox.post(String(p.session_id), `session:${p.session_id}`, String(p.status || "completed"), {
        summary: String(p.summary || message),
      });
      return { posted: true };

    case "synthesize_results":
      return synthesizeResults(sessions, inbox, dagResults, {
        session_ids: p.session_ids as string[] | undefined,
        plan_id: p.plan_id as string | undefined,
      });

    case "plan_task": {
      const title = String(p.title || "Task");
      const description = String(p.description || message);
      const plan = planner.createPlan(title, description, p.success_criteria as string[] | undefined);
      const criteria = (p.success_criteria as string[]) || ["Implement solution", "Verify with tests"];
      return {
        plan_id: title,
        ...plan,
        suggested_tasks: criteria.map((c, i) => ({
          id: `T${i + 1}`,
          label: c.slice(0, 80),
          deps: i === 0 ? [] : [`T${i}`],
        })),
        next: "Pass suggested_tasks to execute_dag",
      };
    }

    case "execute_dag":
      return {
        blocked: true,
        reason: "execute_dag needs structured tasks from plan_task",
        hint: "Call plan_task first, then execute_dag with returned suggested_tasks",
        resume_requested: p.resume === true,
      };

    case "request_approval":
      return approval.request(
        String(p.action || "action"),
        String(p.reason || message),
        (p.risk as "low" | "medium" | "high" | "critical") || "high"
      );

    case "resolve_approval":
      return approval.resolve(
        String(p.approval_id || ""),
        p.approved !== false,
        String(p.resolver || "human")
      );

    case "list_approvals":
      return { approvals: approval.list(p.status as import("@/orchestrator/approval").ApprovalStatus | undefined) };

    case "get_events":
      return {
        path: getEventLog(projectRoot).path,
        events: getEventLog(projectRoot).recent(Number(p.limit) || 50, p.type_prefix as string | undefined),
      };

    case "run_doctor":
      return runDoctor({ projectRoot, skipEmbedTest: p.skip_embed_test === true });

    case "list_worktrees":
      return { porcelain: await listWorktrees() };

    case "remove_worktree":
      return removeWorktree(String(p.session_id || ""), projectRoot, p.delete_branch === true);

    case "scan_issues": {
      if (p.clear) branchHunt.clear();
      const found = await branchHunt.scanPaths(projectRoot, p.paths as string[] | undefined);
      let spawned = 0;
      if (p.spawn_fixes) {
        const before = branchHunt.getIssues().filter((i) => i.sessionId).length;
        await branchHunt.spawnFixes(sessions, maxSessions, { worktree: p.worktree === true });
        spawned = branchHunt.getIssues().filter((i) => i.sessionId).length - before;
      }
      return { found: found.length, spawned, issues: branchHunt.getIssues() };
    }

    case "collect_results":
      return { results: await branchHunt.collectResults(sessions) };

    case "get_branch_status":
      return { summary: branchHunt.summary(), issues: branchHunt.getIssues() };

    case "recall_knowledge": {
      await search.load();
      const results = await search.search(String(p.query || message), Number(p.top_k) || 5);
      return { results };
    }

    case "store_knowledge": {
      await vault.initialize();
      const notePath = String(p.path || `notes/${Date.now()}`);
      const content = String(p.content || message);
      const full = await vault.writeNote(notePath, content);
      await search.addDocument(notePath, notePath.split("/").pop() || notePath, content);
      await search.save();
      return { path: full };
    }

    default:
      return { error: `Tool ${tool} not wired in prompt executor` };
  }
}

export function createPromptExecutorDeps(vaultPath?: string): PromptExecutorDeps {
  const projectRoot = resolveProjectRoot();
  const vaultRoot = resolveVaultRoot(vaultPath);
  const vault = new ObsidianVault(vaultRoot);
  const search = new SemanticSearch(createEmbedder(), resolveIndexDir(vaultRoot));
  const inbox = createInbox();
  return {
    vault,
    search,
    projectRoot,
    sessions: new Map(),
    inbox,
    maxSessions: 5,
    dagResults: new Map(),
    planner: new DeepInterviewPlanner(),
    branchHunt: new BranchHunt(inbox),
    approval: new ApprovalGate(projectRoot),
  };
}
