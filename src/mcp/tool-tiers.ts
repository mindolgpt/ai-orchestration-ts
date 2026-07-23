/** Tool exposure tiers — set AIO_MCP_TOOL_SET=core|wiki|full (default full). */

export type ToolTier = 'core' | 'wiki' | 'full'

const CORE_TOOLS = new Set([
  'aio_prompt',
  'bootstrap_domain',
  'domain_context',
  'query_wiki',
  'ingest_pipeline',
  'file_back',
  'lint_wiki',
  'brainstorm_design',
  'plan_task',
  'execute_dag',
  'spawn_session',
  'check_inbox',
  'run_doctor',
  'bootstrap_harness',
  'bootstrap_product',
  'scaffold_apps',
  'run_implement_loop',
  'sdd_spec',
  'sdd_status',
  'design_architecture',
  'analyze_codebase',
  'recall_knowledge',
  'synthesize_results',
  'generate_usage_guide',
])

const WIKI_EXTRA = new Set([
  'get_wiki_schema',
  'ingest_raw',
  'ingest_source',
  'ingest_source_batch',
  'update_wiki_page',
  'propose_wiki_change',
  'list_wiki_proposals',
  'apply_wiki_proposal',
  'reject_wiki_proposal',
  'wiki_diff',
  'store_knowledge',
  'recall_knowledge',
  'scan_raw_inbox',
  'list_vaults',
])

export function resolveToolTier(): ToolTier {
  const raw = (process.env.AIO_MCP_TOOL_SET || 'full').toLowerCase()
  if (raw === 'core' || raw === 'wiki' || raw === 'full') return raw
  return 'full'
}

export function shouldRegisterTool(name: string): boolean {
  const tier = resolveToolTier()
  if (tier === 'full') return true
  if (CORE_TOOLS.has(name)) return true
  if (tier === 'wiki' && WIKI_EXTRA.has(name)) return true
  return false
}
