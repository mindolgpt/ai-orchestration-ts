import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { MessageInbox } from '@/mcp/inbox'
import {
  ChildSession,
  closeSession,
  spawnSession,
  synthesizeResults,
} from '@/mcp/tools/session-tools'
import { DeepInterviewPlanner } from '@/orchestrator/planner'
import { BranchHunt } from '@/orchestrator/branch-hunt'
import { ApprovalGate } from '@/orchestrator/approval'
import { bootstrapHarness } from '@/harness/bootstrap'
import { designArchitecture } from '@/harness/architecture'
import { buildDomainContextPack, cacheContextPack } from '@/harness/context-pack'
import { runDomainLoop } from '@/harness/loop'
import { loadDomainProfile, saveDomainProfile } from '@/harness/profile'
import { brainstormDesign } from '@/harness/brainstorm'
import { seedStackPlaybooks, seedPatternPlaybooks } from '@/harness/seed-stacks'
import { ALL_STACK_IDS, detectStacksFromText } from '@/harness/stack-playbooks'
import { PromptRoute } from '@/harness/prompt-router'
import { HarnessTarget } from '@/harness/types'
import {
  fileBack,
  getWikiSchema,
  ingestSource,
  lintWiki,
  queryWiki,
  updateWikiPage,
} from '@/knowledge/wiki-ops'
import {
  hasIngestDocumentPayload,
  hasSubstantialIngestContent,
  ingestPipeline,
  ingestRawFromOpts,
  ingestSourceBatch,
  MIN_INGEST_CONTENT_CHARS,
} from '@/knowledge/wiki-ingest-pipeline'
import {
  proposeWikiChange,
  listWikiProposals,
  applyWikiProposal,
  rejectWikiProposal,
  wikiDiff,
} from '@/knowledge/wiki-mr'
import { listVaultEntries, registerVault } from '@/knowledge/vault-registry'
import { scanRawInbox } from '@/knowledge/raw-inbox'
import { collectDashboardStats } from '@/dashboard/server'
import { getEventLog } from '@/observability/events'
import { listWorktrees, removeWorktree } from '@/orchestrator/worktree'
import { createInbox } from '@/mcp/inbox'
import { runDoctor } from '@/doctor/check'
import { createEmbedder } from '@/knowledge/embedder'
import { resolveIndexDir, resolveProjectRoot, resolveVaultRoot } from '@/knowledge/paths'

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export interface PromptExecutorDeps {
  vault: ObsidianVault
  search: SemanticSearch
  projectRoot: string
  sessions: Map<string, ChildSession>
  inbox: MessageInbox
  maxSessions: number
  dagResults: Map<string, unknown>
  planner: DeepInterviewPlanner
  branchHunt: BranchHunt
  approval: ApprovalGate
}

export interface ExecutePromptOptions {
  route: PromptRoute
  message: string
  execute?: boolean
  /** Override / merge params */
  params?: Record<string, unknown>
  harness?: {
    targets?: HarnessTarget[]
    force?: boolean
    answers?: Record<string, unknown>
  }
}

export interface ExecutePromptResult {
  tool: string
  executed: boolean
  result?: unknown
  error?: string
  suggested_params?: Record<string, unknown>
  hint?: string
}

function guardIngestExecute(
  tool: string,
  p: Record<string, unknown>,
  message: string
): ExecutePromptResult | null {
  const destructive = new Set([
    'ingest_pipeline',
    'ingest_raw',
    'ingest_source',
    'ingest_source_batch',
  ])
  if (!destructive.has(tool)) return null

  const payload = {
    content: optStr(p.content),
    file_path: optStr(p.file_path),
    raw_id: optStr(p.raw_id),
    skip_raw: p.skip_raw === true,
  }

  if (tool === 'ingest_source' || tool === 'ingest_source_batch') {
    if (payload.raw_id) return null
    if (hasSubstantialIngestContent(payload.content)) return null
    if (Array.isArray(p.concepts) && p.concepts.length > 0) return null
    return {
      tool,
      executed: false,
      suggested_params: p,
      hint:
        `${tool} refused: provide raw_id and/or substantial content (>= ${MIN_INGEST_CONTENT_CHARS} chars), ` +
        'or concepts[]. Do not pass chat/command text as the document.',
      error: 'missing_ingest_document',
    }
  }

  if (!hasIngestDocumentPayload(payload)) {
    return {
      tool,
      executed: false,
      suggested_params: {
        ...p,
        _message: message.slice(0, 120),
      },
      hint:
        `${tool} refused: pass file_path, raw_id (re-ingest existing raw), or substantial content ` +
        `(>= ${MIN_INGEST_CONTENT_CHARS} chars). Chat text alone is not ingested. ` +
        'Example: ingest_pipeline({ file_path: "docs/x.md", concepts: [...] }) or ' +
        'ingest_pipeline({ raw_id: "a117f128", skip_raw: true, concepts: [...] }).',
      error: 'missing_ingest_document',
    }
  }
  return null
}

export async function executePromptRoute(
  deps: PromptExecutorDeps,
  opts: ExecutePromptOptions
): Promise<ExecutePromptResult> {
  const { route, message } = opts
  const p = { ...route.extracted_params, ...opts.params }

  if (route.tool === 'unknown') {
    return {
      tool: 'unknown',
      executed: false,
      hint: route.agent_hint,
    }
  }

  if (!opts.execute) {
    return {
      tool: route.tool,
      executed: false,
      suggested_params: p,
      hint: 'Set execute:true to run, or call the tool directly with suggested_params.',
    }
  }

  const ingestGuard = guardIngestExecute(route.tool, p, message)
  if (ingestGuard) return ingestGuard

  try {
    const result = await dispatchTool(deps, route.tool, message, p, opts.harness)
    await getEventLog(deps.projectRoot).emit('prompt.execute', {
      tool: route.tool,
      score: route.score,
      keywords: route.matched_keywords.slice(0, 5),
    })
    return { tool: route.tool, executed: true, result }
  } catch (err) {
    return {
      tool: route.tool,
      executed: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function dispatchTool(
  deps: PromptExecutorDeps,
  tool: string,
  message: string,
  p: Record<string, unknown>,
  harness?: ExecutePromptOptions['harness']
): Promise<unknown> {
  const {
    vault,
    search,
    projectRoot,
    sessions,
    inbox,
    maxSessions,
    dagResults,
    planner,
    branchHunt,
    approval,
  } = deps

  switch (tool) {
    case 'bootstrap_harness':
      return bootstrapHarness(vault, {
        projectRoot,
        targets: harness?.targets,
        force: harness?.force,
        prune_foreign: p.prune_foreign === true || /\bprune|foreign|정리\b/i.test(message),
        dry_run_prune: p.dry_run === true,
        profile: {
          description: asStr(p.message) || asStr(p.intent) || message,
          stack: {
            frontend: detectStacksFromText(message).frontend,
            backend: detectStacksFromText(message).backend,
          },
        },
      })

    case 'design_architecture':
      return designArchitecture(vault, search, asStr(p.intent, message), {
        project_root: projectRoot,
        answers: harness?.answers as import('@/harness/architecture').ArchitectureAnswers,
        frontend: detectStacksFromText(message).frontend,
        backend: detectStacksFromText(message).backend,
        mobile: detectStacksFromText(message).mobile,
      })

    case 'brainstorm_design': {
      const fromParams =
        p.answers && typeof p.answers === 'object'
          ? (p.answers as import('@/harness/brainstorm').BrainstormAnswers)
          : {}
      const fromHarness =
        harness?.answers && typeof harness.answers === 'object'
          ? (harness.answers as import('@/harness/brainstorm').BrainstormAnswers)
          : {}
      // params.answers win over aio_prompt harness.answers; never skip only because answers bag exists
      const answers = { ...fromHarness, ...fromParams }
      return brainstormDesign(vault, search, asStr(p.topic) || asStr(p.intent) || message, {
        project_root: projectRoot,
        focus: Array.isArray(p.focus)
          ? (p.focus as import('@/harness/brainstorm').BrainstormFocus[])
          : undefined,
        answers,
        skip_questions: p.skip_questions === true,
        write_docs: typeof p.write_docs === 'boolean' ? p.write_docs : undefined,
      })
    }

    case 'seed_stack_playbooks':
      return {
        stacks: await seedStackPlaybooks(vault, search),
        patterns: await seedPatternPlaybooks(vault, search),
      }

    case 'run_domain_loop':
      return runDomainLoop(vault, search, asStr(p.task, message), { project_root: projectRoot })

    case 'bootstrap_domain': {
      const pack = await buildDomainContextPack(vault, search, asStr(p.task, message), {
        project_root: projectRoot,
      })
      const cachePath = await cacheContextPack(pack, projectRoot)
      return { ...pack, cache_path: cachePath }
    }

    case 'get_domain_profile':
      return loadDomainProfile(vault, projectRoot)

    case 'save_domain_profile': {
      const { profile } = await loadDomainProfile(vault, projectRoot)
      const next = {
        ...profile,
        description: asStr(p.content) || asStr(p.title) || message,
        domain: asStr(p.title, profile.domain),
      }
      const path = await saveDomainProfile(next, projectRoot)
      return { saved: true, path, profile: next }
    }

    case 'list_stack_playbooks':
      return { count: ALL_STACK_IDS.length, stacks: ALL_STACK_IDS }

    case 'get_wiki_schema':
      return getWikiSchema(vault)

    case 'ingest_raw':
      return ingestRawFromOpts(vault, {
        title: asStr(p.title, 'Untitled'),
        content: optStr(p.content) || '',
        file_path: optStr(p.file_path),
        project_root: projectRoot,
      })

    case 'ingest_source':
      return ingestSource(vault, search, {
        title: asStr(p.title, 'Untitled'),
        content: asStr(p.content, ''),
        subdir: optStr(p.subdir),
        raw_id: optStr(p.raw_id),
      })

    case 'ingest_source_batch':
      return ingestSourceBatch(vault, search, {
        concepts:
          (p.concepts as import('@/knowledge/wiki-ingest-pipeline').IngestConceptInput[]) || [
            { title: asStr(p.title, 'Untitled'), content: asStr(p.content, '') },
          ],
        raw_id: optStr(p.raw_id),
      })

    case 'ingest_pipeline':
      return ingestPipeline(vault, search, {
        title: optStr(p.title),
        content: optStr(p.content),
        file_path: optStr(p.file_path),
        raw_id: optStr(p.raw_id),
        skip_raw: p.skip_raw === true || Boolean(optStr(p.raw_id)),
        project_root: projectRoot,
        run_lint: p.run_lint !== false,
        lint_deep: p.deep === true || p.lint_deep === true,
        concepts: p.concepts as
          import('@/knowledge/wiki-ingest-pipeline').IngestConceptInput[] | undefined,
      })

    case 'update_wiki_page':
      return updateWikiPage(vault, search, {
        title: asStr(p.title, 'Untitled'),
        content: asStr(p.content, message),
        subdir: optStr(p.subdir),
      })

    case 'query_wiki':
      return queryWiki(vault, search, asStr(p.query, message), Number(p.top_k) || 5)

    case 'file_back':
      return fileBack(vault, search, {
        title: asStr(p.title, 'Synthesis'),
        content: asStr(p.content, message),
        query: asStr(p.query, message),
        subdir: optStr(p.subdir),
      })

    case 'lint_wiki':
      return lintWiki(vault, {
        deep: p.deep === true,
        staleDays: Number(p.stale_days) || 90,
      })

    case 'propose_wiki_change':
      return proposeWikiChange(
        vault,
        {
          title: asStr(p.title, 'Untitled'),
          content: asStr(p.content, message),
          rationale: optStr(p.rationale),
          subdir: optStr(p.subdir),
        },
        projectRoot
      )

    case 'list_wiki_proposals':
      return listWikiProposals(
        projectRoot,
        p.status as import('@/knowledge/wiki-mr').WikiProposalStatus | undefined
      )

    case 'apply_wiki_proposal':
      return applyWikiProposal(
        vault,
        search,
        { id: asStr(p.id) || asStr(p.proposal_id), resolver: optStr(p.resolver) },
        projectRoot
      )

    case 'reject_wiki_proposal':
      return rejectWikiProposal(
        asStr(p.id) || asStr(p.proposal_id),
        { reason: optStr(p.reason), resolver: optStr(p.resolver) },
        projectRoot
      )

    case 'wiki_diff':
      return wikiDiff(
        vault,
        asStr(p.title, 'Untitled'),
        asStr(p.content, message),
        optStr(p.subdir)
      )

    case 'scan_raw_inbox':
      return scanRawInbox(vault, search, {
        project_root: projectRoot,
        subdir: optStr(p.subdir),
        run_lint: p.run_lint !== false,
      })

    case 'list_vaults':
      return {
        vaults: await listVaultEntries(projectRoot),
        active_env: process.env.AIO_VAULT_NAME || null,
      }

    case 'register_vault':
      return registerVault(
        {
          name: asStr(p.name, 'main'),
          path: asStr(p.path, 'vault'),
          domain: optStr(p.domain),
          description: optStr(p.description),
          default: p.default === true,
        },
        projectRoot
      )

    case 'get_dashboard_stats':
      return collectDashboardStats(vault, projectRoot)

    case 'spawn_session':
      return spawnSession(sessions, inbox, maxSessions, asStr(p.task, message), undefined, {
        worktree: p.worktree === true,
        projectRoot,
      })

    case 'check_inbox':
      return {
        backend: inbox.backendName,
        messages: inbox.poll(optStr(p.session_id), optStr(p.status)),
      }

    case 'list_sessions':
      return {
        running: Array.from(sessions.values()).filter((s) => s.status === 'running').length,
        max_sessions: maxSessions,
        sessions: Array.from(sessions.values()).map((s) => ({
          id: s.id,
          status: s.status,
          task: s.task,
        })),
      }

    case 'get_session': {
      const sid = asStr(p.session_id)
      const s = sessions.get(sid)
      if (!s) return { error: `Session ${sid} not found` }
      return { id: s.id, status: s.status, task: s.task, stdout_tail: s.stdout.slice(-1000) }
    }

    case 'close_session':
      return closeSession(
        sessions,
        asStr(p.session_id),
        p.kill !== false,
        p.remove_worktree === true
      )

    case 'send_message': {
      const sid = asStr(p.session_id)
      const s = sessions.get(sid)
      if (!s) return { error: 'session not found' }
      s.pendingMessages.push(asStr(p.message, message))
      return { queued: true }
    }

    case 'report_result': {
      const sid = asStr(p.session_id)
      const s = sessions.get(sid)
      if (!s) return { error: `Session ${sid} not found` }
      const secret = optStr(p.session_secret)
      if (s.sessionSecret && process.env.AIO_ALLOW_REPORT_WITHOUT_SECRET !== '1') {
        if (secret !== s.sessionSecret) {
          return { error: 'session_secret required (from spawn prompt / AIO_SESSION_SECRET env)' }
        }
      }
      inbox.post(sid, `session:${sid}`, asStr(p.status, 'completed'), {
        summary: asStr(p.summary, message),
      })
      if (p.status === 'completed' || p.status === 'failed') {
        s.status = p.status
      }
      return { posted: true }
    }

    case 'synthesize_results':
      return synthesizeResults(sessions, inbox, dagResults, {
        session_ids: p.session_ids as string[] | undefined,
        plan_id: p.plan_id as string | undefined,
      })

    case 'plan_task': {
      const title = asStr(p.title, 'Task')
      const description = asStr(p.description, message)
      const plan = planner.createPlan(
        title,
        description,
        p.success_criteria as string[] | undefined
      )
      const criteria = (p.success_criteria as string[]) || [
        'Implement solution',
        'Verify with tests',
      ]
      return {
        plan_id: title,
        ...plan,
        suggested_tasks: criteria.map((c, i) => ({
          id: `T${i + 1}`,
          label: c.slice(0, 80),
          deps: i === 0 ? [] : [`T${i}`],
        })),
        next: 'Pass suggested_tasks to execute_dag',
      }
    }

    case 'execute_dag':
      return {
        blocked: true,
        reason: 'execute_dag needs structured tasks from plan_task',
        hint: 'Call plan_task first, then execute_dag with returned suggested_tasks',
        resume_requested: p.resume === true,
      }

    case 'request_approval':
      return approval.request(
        asStr(p.action, 'action'),
        asStr(p.reason, message),
        (p.risk as 'low' | 'medium' | 'high' | 'critical') || 'high'
      )

    case 'resolve_approval': {
      const approved = p.approved === true
      const rejected = p.approved === false
      if (!approved && !rejected) {
        return { error: 'resolve_approval requires explicit approved:true or approved:false' }
      }
      return approval.resolve(asStr(p.approval_id), approved, asStr(p.resolver, 'human'), {
        confirmCode: typeof p.confirm_code === 'string' ? p.confirm_code : undefined,
      })
    }

    case 'list_approvals':
      return {
        approvals: approval.list(
          p.status as import('@/orchestrator/approval').ApprovalStatus | undefined
        ),
      }

    case 'get_events':
      return {
        path: getEventLog(projectRoot).path,
        events: getEventLog(projectRoot).recent(
          Number(p.limit) || 50,
          p.type_prefix as string | undefined
        ),
      }

    case 'run_doctor':
      return runDoctor({ projectRoot, skipEmbedTest: p.skip_embed_test === true })

    case 'list_worktrees':
      return { porcelain: await listWorktrees() }

    case 'remove_worktree':
      return removeWorktree(asStr(p.session_id), projectRoot, p.delete_branch === true)

    case 'scan_issues': {
      if (p.clear) branchHunt.clear()
      const found = await branchHunt.scanPaths(projectRoot, p.paths as string[] | undefined)
      let spawned = 0
      if (p.spawn_fixes) {
        const before = branchHunt.getIssues().filter((i) => i.sessionId).length
        await branchHunt.spawnFixes(sessions, maxSessions, { worktree: p.worktree === true })
        spawned = branchHunt.getIssues().filter((i) => i.sessionId).length - before
      }
      return { found: found.length, spawned, issues: branchHunt.getIssues() }
    }

    case 'collect_results':
      return { results: await branchHunt.collectResults(sessions) }

    case 'get_branch_status':
      return { summary: branchHunt.summary(), issues: branchHunt.getIssues() }

    case 'recall_knowledge': {
      await search.load()
      const results = await search.search(asStr(p.query, message), Number(p.top_k) || 5)
      return { results }
    }

    case 'store_knowledge': {
      await vault.initialize()
      const notePath = asStr(p.path, `notes/${Date.now()}`)
      const content = asStr(p.content, message)
      const full = await vault.writeNote(notePath, content)
      await search.addDocument(notePath, notePath.split('/').pop() || notePath, content)
      await search.save()
      return { path: full }
    }

    default:
      return { error: `Tool ${tool} not wired in prompt executor` }
  }
}

export function createPromptExecutorDeps(vaultPath?: string): PromptExecutorDeps {
  const projectRoot = resolveProjectRoot()
  const vaultRoot = resolveVaultRoot(vaultPath)
  const vault = new ObsidianVault(vaultRoot)
  const search = new SemanticSearch(createEmbedder(), resolveIndexDir(vaultRoot))
  const inbox = createInbox()
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
  }
}
