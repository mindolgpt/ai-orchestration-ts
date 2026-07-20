import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { DeepInterviewPlanner } from '@/orchestrator/planner'
import {
  buildDomainContextPack,
  cacheContextPack,
  contextPackToMarkdown,
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
  }
): Promise<DomainLoopResult> {
  const pack = await buildDomainContextPack(vault, search, task, {
    top_k: opts?.top_k,
    extra_queries: opts?.extra_queries,
    project_root: opts?.project_root,
  })

  if (opts?.cache !== false) {
    await cacheContextPack(pack, opts?.project_root)
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

  return {
    phase: 'bootstrap',
    context_pack: pack,
    plan_stub: planStub,
    agent_instructions: agentInstructions,
  }
}
