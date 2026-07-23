/** Workflow step ids for aio_prompt dry-run / routing hints. */
const TOOL_WORKFLOW_STEP: Record<string, string> = {
  bootstrap_product: 'onboard',
  bootstrap_harness: 'onboard',
  scaffold_apps: 'onboard',
  run_doctor: 'onboard',
  seed_stack_playbooks: 'onboard',
  bootstrap_domain: 'implement_prep',
  domain_context: 'implement_prep',
  run_domain_loop: 'implement_prep',
  run_implement_loop: 'execute',
  sdd_spec: 'plan',
  sdd_status: 'plan',
  query_wiki: 'research',
  recall_knowledge: 'research',
  brainstorm_design: 'design',
  design_architecture: 'design',
  plan_task: 'plan',
  execute_dag: 'execute',
  spawn_session: 'parallel_execute',
  check_inbox: 'parallel_execute',
  synthesize_results: 'parallel_execute',
  ingest_pipeline: 'ingest',
  ingest_raw: 'ingest',
  ingest_source: 'ingest',
  ingest_source_batch: 'ingest',
  file_back: 'document',
  lint_wiki: 'validate',
  update_wiki_page: 'document',
}

export function workflowStepForTool(tool: string): string | undefined {
  return TOOL_WORKFLOW_STEP[tool]
}
