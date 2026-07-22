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
import { runDomainLoop, domainContext } from '@/harness/loop'
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
import { workflowStepForTool } from '@/harness/workflow-steps'
import {
  enrichIngestParams,
  extractConfirmCode,
  inferApprovalFromMessage,
  inferReportStatus,
  ingestPayloadReady,
} from '@/harness/nl-params'
import { executeDagRun, DagTaskInput, ExecuteDagRunInput } from '@/orchestrator/execute-dag-run'

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
  fix?: string
  workflow_step?: string
}

function normalizeDagTasks(raw: unknown): DagTaskInput[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (t): t is Record<string, unknown> => typeof t === 'object' && t !== null && !Array.isArray(t)
    )
    .map((t, i) => ({
      id: asStr(t.id, `T${i + 1}`),
      label: asStr(t.label, asStr(t.id, `Task ${i + 1}`)),
      deps: Array.isArray(t.deps) ? (t.deps as string[]) : undefined,
      prompt: optStr(t.prompt),
      timeout_ms: typeof t.timeout_ms === 'number' ? t.timeout_ms : undefined,
    }))
}

function buildAutoPlanTasks(
  title: string,
  description: string,
  successCriteria?: string[]
): DagTaskInput[] {
  const criteria = successCriteria?.length
    ? successCriteria
    : ['Complete the described work', 'Verify with tests']
  return criteria.map((c, i) => ({
    id: `T${i + 1}`,
    label: c.slice(0, 80),
    deps: i === 0 ? [] : [`T${i}`],
  }))
}

function guardIngestExecute(
  tool: string,
  p: Record<string, unknown>,
  message: string,
  projectRoot: string
): ExecutePromptResult | null {
  const destructive = new Set([
    'ingest_pipeline',
    'ingest_raw',
    'ingest_source',
    'ingest_source_batch',
  ])
  if (!destructive.has(tool)) return null

  const enriched = enrichIngestParams(p, message, projectRoot)
  Object.assign(p, enriched)

  const payload = {
    content: optStr(p.content),
    file_path: optStr(p.file_path),
    raw_id: optStr(p.raw_id),
    skip_raw: p.skip_raw === true,
  }

  if (ingestPayloadReady(p, message, projectRoot)) return null

  if (tool === 'ingest_source' || tool === 'ingest_source_batch') {
    if (payload.raw_id) return null
    if (hasSubstantialIngestContent(payload.content)) return null
    if (Array.isArray(p.concepts) && p.concepts.length > 0) return null
  }

  const fileHint = payload.file_path ? ` Found path: ${payload.file_path}.` : ''
  return {
    tool,
    executed: false,
    suggested_params: p,
    hint:
      `${tool} needs file_path, raw_id, substantial content (>= ${MIN_INGEST_CONTENT_CHARS} chars), or concepts[].` +
      fileHint +
      ' Example: "ingest pipeline README.md" or paste a long document body.',
    error: 'missing_ingest_document',
    fix: 'ingest_pipeline with file_path or raw_id + concepts',
    workflow_step: 'ingest',
  }
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
      workflow_step: workflowStepForTool(route.tool),
    }
  }

  const ingestGuard = guardIngestExecute(route.tool, p, message, deps.projectRoot)
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
    case 'bootstrap_harness': {
      const interviewKeywords =
        /\b(인터뷰|질문|물어|대화|설정|물어봐|interview|ask|question|setup wizard|guide|custom)\b/i
      const wantsInterview = interviewKeywords.test(message) || p.interview === true
      return bootstrapHarness(vault, {
        projectRoot,
        targets: harness?.targets,
        force: harness?.force,
        interview: wantsInterview,
        interview_answers: p.interview_answers as
          import('@/harness/bootstrap-interview').HarnessInterviewAnswers | undefined,
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
    }

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
        response_format:
          p.response_format === 'markdown' || p.response_format === 'structured'
            ? p.response_format
            : undefined,
      })
    }

    case 'domain_context':
      return domainContext(vault, search, asStr(p.task, message), {
        project_root: projectRoot,
        top_k: Number(p.top_k) || undefined,
        include_plan: p.include_plan === true,
        format:
          p.format === 'json' || p.format === 'markdown' || p.format === 'path' ? p.format : 'path',
      })

    case 'seed_stack_playbooks':
      return {
        stacks: await seedStackPlaybooks(vault, search),
        patterns: await seedPatternPlaybooks(vault, search),
      }

    case 'run_domain_loop':
      return runDomainLoop(vault, search, asStr(p.task, message), {
        project_root: projectRoot,
        format: 'path',
      })

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
        lint_mode:
          p.lint_mode === 'none' || p.lint_mode === 'summary' || p.lint_mode === 'full'
            ? p.lint_mode
            : p.run_lint === false
              ? 'none'
              : 'summary',
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
      return queryWiki(vault, search, asStr(p.query, message), Number(p.top_k) || 5, {
        response_mode:
          p.response_mode === 'full' || p.response_mode === 'snippets'
            ? p.response_mode
            : 'snippets',
      })

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
          return {
            ok: false,
            error: 'session_secret required',
            hint: 'Use session_secret from spawn_session response or set AIO_ALLOW_REPORT_WITHOUT_SECRET=1',
          }
        }
      }
      const status = asStr(p.status, inferReportStatus(message) || 'completed')
      inbox.post(sid, `session:${sid}`, status, {
        summary: asStr(p.summary, message),
      })
      if (status === 'completed' || status === 'failed') {
        s.status = status
      }
      return { posted: true, status }
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

    case 'execute_dag': {
      let tasks = normalizeDagTasks(p.tasks || p.suggested_tasks)
      let planId = asStr(p.plan_id, asStr(p.title, 'Task'))

      if (!tasks.length) {
        const title = asStr(p.title, planId)
        const description = asStr(p.description, message)
        const criteria = p.success_criteria as string[] | undefined
        planner.createPlan(title, description, criteria)
        tasks = buildAutoPlanTasks(title, description, criteria)
        planId = title
      }

      return executeDagRun(
        {
          projectRoot,
          sessions,
          inbox,
          dagResults,
          maxSessions,
          approval,
        },
        {
          plan_id: planId,
          tasks,
          resume: p.resume === true,
          clear_checkpoint: p.clear_checkpoint === true,
          fail_fast: p.fail_fast === true,
          max_parallel: typeof p.max_parallel === 'number' ? p.max_parallel : undefined,
          worktree: p.worktree === true,
          runtime: p.runtime as ExecuteDagRunInput['runtime'],
          approval_id: optStr(p.approval_id),
          skip_approval: p.skip_approval === true,
          require_approval_if_dangerous: p.require_approval_if_dangerous !== false,
          ralph_max_retries:
            typeof p.ralph_max_retries === 'number' ? p.ralph_max_retries : undefined,
          ralph_verify: p.ralph_verify !== false,
        }
      )
    }

    case 'request_approval':
      return approval.request(
        asStr(p.action, 'action'),
        asStr(p.reason, message),
        (p.risk as 'low' | 'medium' | 'high' | 'critical') || 'high'
      )

    case 'resolve_approval': {
      let approved: boolean | undefined
      if (p.approved === true) approved = true
      else if (p.approved === false) approved = false
      else approved = inferApprovalFromMessage(message)

      if (approved === undefined) {
        return {
          ok: false,
          error: 'approval_decision_required',
          hint: 'Say approve/승인 or reject/거부 in the message, or pass approved:true|false',
          fix: 'resolve_approval with approval_id and approved:true or approved:false',
        }
      }
      return approval.resolve(asStr(p.approval_id), approved, asStr(p.resolver, 'human'), {
        confirmCode: optStr(p.confirm_code) || extractConfirmCode(message),
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
      const data = await queryWiki(vault, search, asStr(p.query, message), Number(p.top_k) || 5, {
        response_mode: 'snippets',
      })
      return {
        deprecated: true,
        use_instead: 'query_wiki',
        results: data.pages,
      }
    }

    case 'store_knowledge': {
      await vault.initialize()
      const notePath = asStr(p.path, `notes/${Date.now()}`)
      const content = asStr(p.content, message)
      const full = await vault.writeNote(notePath, content)
      await search.addDocument(notePath, notePath.split('/').pop() || notePath, content)
      await search.save()
      return {
        deprecated: true,
        use_instead: 'ingest_pipeline or file_back',
        path: full,
      }
    }

    case 'generate_usage_guide': {
      const { writeDocs } = await import('@/docs/generator')
      const files = await writeDocs(projectRoot)
      return { ok: true, files }
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
