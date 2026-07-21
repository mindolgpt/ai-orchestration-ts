import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { DeepInterviewPlanner } from '@/orchestrator/planner'
import {
  buildDomainContextPack,
  cacheContextPack,
  contextPackToMarkdown,
  contextCachePath,
} from '@/harness/context-pack'
import { loadDomainProfile } from '@/harness/profile'
import { DomainLoopResult } from '@/harness/types'

export async function runDomainLoop(
  vault: ObsidianVault,
  search: SemanticSearch,
  task: string,
  opts?: {
    top_k?: number
    extra_queries?: string[]
    include_plan?: boolean
    cache?: boolean
    project_root?: string
    /** json | markdown | path (cache file only — lowest tokens) */
    format?: 'json' | 'markdown' | 'path'
  }
): Promise<DomainLoopResult | { cache_path: string; format: 'path' }> {
  const pack = await buildDomainContextPack(vault, search, task, {
    top_k: opts?.top_k,
    extra_queries: opts?.extra_queries,
    project_root: opts?.project_root,
  })

  const cachePath =
    opts?.cache !== false
      ? await cacheContextPack(pack, opts?.project_root)
      : contextCachePath(opts?.project_root)

  if (opts?.format === 'path') {
    return { cache_path: cachePath, format: 'path' as const }
  }

  const { profile } = await loadDomainProfile(vault, opts?.project_root)

  let planStub: DomainLoopResult['plan_stub']
  if (opts?.include_plan !== false) {
    const planner = new DeepInterviewPlanner()
    const plan = planner.createPlan(
      task.slice(0, 80),
      task,
      [
        'Wiki rules applied with citations',
        'Implementation matches bounded contexts',
        'Tests or verification pass',
      ],
      [
        'Follow vault wiki and raw sources',
        profile.stack?.backend
          ? `Backend stack: ${profile.stack.backend}`
          : 'Respect existing project stack',
        profile.stack?.frontend
          ? `Frontend stack: ${profile.stack.frontend}`
          : 'Respect existing frontend conventions',
      ]
    )
    planStub = {
      title: plan.title,
      suggested_success_criteria: plan.successCriteria,
      suggested_constraints: plan.constraints,
    }
  }

  const agentInstructions = [
    '# Domain loop — agent brief',
    '',
    contextPackToMarkdown(pack),
    '',
    '## Next MCP calls',
    '',
    '1. `plan_task` with title/description from this brief',
    '2. Implement using wiki citations above',
    '3. `execute_dag` if multiple parallel tasks',
    '4. **Verify**: run project tests (`npm test`, `./gradlew test`, etc.)',
    '5. `file_back` when decisions are durable',
    '6. `lint_wiki --deep` after wiki changes',
    '',
    planStub
      ? `## Suggested plan\n- Title: ${planStub.title}\n- Criteria: ${planStub.suggested_success_criteria.join('; ')}\n- Constraints: ${planStub.suggested_constraints.join('; ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  if (opts?.format === 'markdown') {
    return {
      phase: 'bootstrap',
      format: 'markdown' as const,
      markdown: agentInstructions,
      cache_path: cachePath,
      plan_stub: planStub,
    }
  }

  return {
    phase: 'bootstrap',
    context_pack: pack,
    plan_stub: planStub,
    cache_path: cachePath,
  }
}

/** Unified domain context — replaces separate bootstrap_domain / run_domain_loop calls. */
export async function domainContext(
  vault: ObsidianVault,
  search: SemanticSearch,
  task: string,
  opts?: {
    top_k?: number
    extra_queries?: string[]
    include_plan?: boolean
    format?: 'json' | 'markdown' | 'path'
    project_root?: string
  }
) {
  if (opts?.include_plan) {
    return runDomainLoop(vault, search, task, {
      ...opts,
      include_plan: true,
      cache: true,
    })
  }
  const pack = await buildDomainContextPack(vault, search, task, {
    top_k: opts?.top_k,
    extra_queries: opts?.extra_queries,
    project_root: opts?.project_root,
  })
  const cachePath = await cacheContextPack(pack, opts?.project_root)
  if (opts?.format === 'path') {
    return { cache_path: cachePath, format: 'path' as const }
  }
  if (opts?.format === 'markdown') {
    return {
      markdown: contextPackToMarkdown(pack),
      cache_path: cachePath,
    }
  }
  return { ...pack, cache_path: cachePath }
}
