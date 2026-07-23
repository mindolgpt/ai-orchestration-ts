import * as fs from 'fs/promises'
import * as path from 'path'
import { resolveProjectRoot } from '@/knowledge/paths'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { createEmbedder } from '@/knowledge/embedder'
import { resolveIndexDir } from '@/knowledge/paths'
import { seedStackPlaybooks } from '@/harness/seed-stacks'
import { runHarnessInterview, HarnessInterviewAnswers } from '@/harness/bootstrap-interview'
import { bootstrapHarness } from '@/harness/bootstrap'
import { scaffoldApps } from '@/harness/scaffold/scaffold-app'
import { writeCursorSkills } from '@/harness/skills'
import { scanProject } from '@/harness/project-scan'
import { SddPipeline } from '@/sdd/pipeline'
import { ApprovalGate } from '@/orchestrator/approval'
import { writeAcceptanceJson } from '@/sdd/from-wiki'
import { runImplementLoop } from '@/harness/implement-loop'
import { getEventLog } from '@/observability/events'
import { designArchitecture } from '@/harness/architecture'

export type ProductPhase =
  'wiki' | 'sdd' | 'interview' | 'harness' | 'contracts' | 'scaffold' | 'ci' | 'implement'

export type PhaseStatus = 'pending' | 'done' | 'skipped' | 'blocked'

export interface ProductPipelineState {
  id: string
  domain: string
  description?: string
  updated_at: string
  phases: ProductPhase[]
  phase_status: Record<ProductPhase, PhaseStatus>
  interview_answers?: HarnessInterviewAnswers
  sdd?: { spec_id?: string; design_id?: string }
  project_scan_path?: string
  blocked_reason?: string
  files_written?: string[]
}

export interface BootstrapProductOptions {
  projectRoot?: string
  domain?: string
  description?: string
  sources?: string[]
  requirements?: Array<{
    id: string
    priority: 'P0' | 'P1' | 'P2'
    description: string
    acceptance_criteria?: string[]
  }>
  interview_answers?: HarnessInterviewAnswers
  interview?: boolean
  non_interactive?: boolean
  auto_approve_spec?: boolean
  resume?: boolean
  reset?: boolean
  phases?: ProductPhase[]
  format?: 'path' | 'summary'
  force_scaffold?: boolean
  vault?: ObsidianVault
  search?: SemanticSearch
}

const ALL_PHASES: ProductPhase[] = [
  'wiki',
  'sdd',
  'interview',
  'harness',
  'contracts',
  'scaffold',
  'ci',
  'implement',
]

function checkpointPath(root: string): string {
  return path.join(root, '.aio', 'product-pipeline.json')
}

async function loadCheckpoint(root: string): Promise<ProductPipelineState | null> {
  try {
    const raw = await fs.readFile(checkpointPath(root), 'utf-8')
    return JSON.parse(raw) as ProductPipelineState
  } catch {
    return null
  }
}

async function saveCheckpoint(root: string, state: ProductPipelineState): Promise<void> {
  state.updated_at = new Date().toISOString()
  await fs.mkdir(path.dirname(checkpointPath(root)), { recursive: true })
  await fs.writeFile(checkpointPath(root), JSON.stringify(state, null, 2), 'utf-8')
}

async function ensureVault(root: string): Promise<void> {
  const vaultRoot = path.join(root, 'vault')
  const dirs = ['raw', 'wiki', 'raw-inbox']
  for (const d of dirs) {
    await fs.mkdir(path.join(vaultRoot, d), { recursive: true })
  }
  const agents = path.join(vaultRoot, 'AGENTS.md')
  try {
    await fs.access(agents)
  } catch {
    await fs.writeFile(
      agents,
      '# Vault schema\n\nMaintain wiki with citations. raw/ is immutable.\n',
      'utf-8'
    )
  }
  for (const f of ['wiki/index.md', 'wiki/log.md']) {
    const p = path.join(vaultRoot, f)
    try {
      await fs.access(p)
    } catch {
      await fs.writeFile(p, f.includes('index') ? '# Wiki index\n' : '# Wiki log\n', 'utf-8')
    }
  }
}

async function seedCi(root: string, force: boolean): Promise<string[]> {
  const written: string[] = []
  const wfDir = path.join(root, '.github', 'workflows')
  await fs.mkdir(wfDir, { recursive: true })
  const files: Record<string, string> = {
    'aio-wiki-lint.yml': `name: aio-wiki-lint\non: [push, pull_request]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: '20' }\n      - run: npx -y @mindol1004/aio-mcp wiki-lint --fail\n`,
    'aio-verify.yml': `name: aio-verify\non: [push, pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: '20' }\n      - run: npm ci || npm install\n      - run: npm run build --if-present\n      - run: npm run lint --if-present\n      - run: npm run typecheck --if-present\n      - run: npm test --if-present\n`,
  }
  for (const [name, body] of Object.entries(files)) {
    const abs = path.join(wfDir, name)
    try {
      await fs.access(abs)
      if (!force) continue
    } catch {
      /* create */
    }
    await fs.writeFile(abs, body, 'utf-8')
    written.push(abs)
  }
  return written
}

export async function bootstrapProduct(
  opts: BootstrapProductOptions = {}
): Promise<Record<string, unknown>> {
  const root = path.resolve(opts.projectRoot || resolveProjectRoot())
  const events = getEventLog(root)
  const phases = opts.phases?.length ? opts.phases : ALL_PHASES
  const resume = opts.resume !== false
  const interviewEnabled = opts.interview !== false

  let state = resume && !opts.reset ? await loadCheckpoint(root) : null

  if (!state || opts.reset) {
    state = {
      id: `pp_${Date.now().toString(36)}`,
      domain: opts.domain || 'general',
      description: opts.description,
      updated_at: new Date().toISOString(),
      phases,
      phase_status: Object.fromEntries(ALL_PHASES.map((p) => [p, 'pending'])) as Record<
        ProductPhase,
        PhaseStatus
      >,
      interview_answers: opts.interview_answers,
      files_written: [],
    }
  } else {
    if (opts.domain) state.domain = opts.domain
    if (opts.description) state.description = opts.description
    if (opts.interview_answers) {
      state.interview_answers = { ...state.interview_answers, ...opts.interview_answers }
    }
    state.phases = phases
  }

  await events.emit('product.pipeline.start', { id: state.id, phases })

  const vault = opts.vault || new ObsidianVault(path.join(root, 'vault'))
  let search = opts.search
  const getSearch = () => {
    if (!search) {
      search = new SemanticSearch(createEmbedder(), {
        indexDir: resolveIndexDir(vault.rootPath),
        vaultRoot: vault.rootPath,
      })
    }
    return search
  }

  // --- wiki ---
  if (phases.includes('wiki') && state.phase_status.wiki !== 'done') {
    await ensureVault(root)
    // Stack playbooks are optional here (avoid embedding download during onboard).
    // Prefer: seed_stack_playbooks MCP / aio seed-stacks
    if (process.env.AIO_SEED_STACKS_ON_PRODUCT === '1') {
      await seedStackPlaybooks(vault, getSearch()).catch(() => undefined)
    }
    const overview = path.join(root, 'vault', 'wiki', `${state.domain}-overview.md`)
    await fs.mkdir(path.dirname(overview), { recursive: true })
    try {
      await fs.access(overview)
    } catch {
      await fs.writeFile(
        overview,
        `# ${state.domain}\n\n${state.description || ''}\n\nSeeded by bootstrap_product.\n`,
        'utf-8'
      )
      state.files_written?.push(overview)
    }
    if (opts.sources?.length) {
      for (const src of opts.sources) {
        try {
          const content = await fs.readFile(src, 'utf-8')
          const dest = path.join(root, 'vault', 'raw', path.basename(src))
          await fs.mkdir(path.dirname(dest), { recursive: true })
          await fs.writeFile(dest, content, 'utf-8')
        } catch {
          /* skip missing source */
        }
      }
    }
    state.phase_status.wiki = 'done'
    await saveCheckpoint(root, state)
  }

  // --- sdd ---
  if (phases.includes('sdd') && state.phase_status.sdd !== 'done') {
    const approval = new ApprovalGate(root)
    await approval.load()
    const pipeline = new SddPipeline(root, approval, { vault, search: getSearch() })
    const finalReqs = (opts.requirements || []).map((r) => ({
      id: r.id,
      priority: r.priority,
      description: r.description,
      acceptanceCriteria: r.acceptance_criteria,
    }))
    if (!finalReqs.length) {
      finalReqs.push({
        id: 'REQ-1',
        priority: 'P0',
        description: `Core ${state.domain} capability`,
        acceptanceCriteria: ['Happy path works', 'Covered by tests'],
      })
    }

    const created = await pipeline.createSpec({
      project: state.domain,
      title: `${state.domain} product`,
      productContext: state.description || `${state.domain} product context`,
      requirements: finalReqs,
    })
    state.sdd = { ...state.sdd, spec_id: created.spec?.id }
    if (created.spec?.id) {
      await writeAcceptanceJson(root, created.spec.id, finalReqs)
    }

    if (opts.auto_approve_spec && created.spec) {
      created.spec.status = 'approved'
      created.spec.approvedAt = Date.now()
      created.spec.approvedBy = 'auto'
      const store = (pipeline as unknown as { specStore: { save: (s: unknown) => Promise<void> } })
        .specStore
      await store.save(created.spec)
      const design = await pipeline.createDesign(created.spec.id)
      state.sdd = { ...state.sdd, design_id: design.design?.id }
      // Auto-approve the design and generate tasks.md so the implement phase
      // runs against real SDD tasks instead of a generic fallback slice.
      if (design.design?.id) {
        const tasksState = await pipeline.autoApproveDesignAndGenerateTasks(design.design.id)
        if (tasksState.tasks?.tasksPath) {
          state.files_written?.push(tasksState.tasks.tasksPath)
        }
      }
      state.phase_status.sdd = 'done'
    } else {
      state.phase_status.sdd = 'blocked'
      state.blocked_reason = 'awaiting_sdd_approval'
      await saveCheckpoint(root, state)
      return summarize(state, root, opts.format, {
        status: 'blocked',
        next_steps: [
          `aio approval list`,
          `aio sdd approve --id ${created.spec?.id} --type spec  (or resolve_approval)`,
          `Then: bootstrap_product({ resume: true })`,
          `sdd_status() to verify`,
        ],
      })
    }
    await saveCheckpoint(root, state)
  }

  // Unblock sdd if previously blocked but now approved externally
  if (state.phase_status.sdd === 'blocked' && state.sdd?.spec_id) {
    const approval = new ApprovalGate(root)
    const pipeline = new SddPipeline(root, approval, { vault, search: getSearch() })
    const st = await pipeline.getState()
    const match = st.find((s) => s.spec?.id === state.sdd?.spec_id)
    if (match?.spec?.status === 'approved') {
      if (!state.sdd.design_id) {
        const design = await pipeline.createDesign(match.spec.id)
        state.sdd.design_id = design.design?.id
        // Externally-approved spec → also produce approved design + tasks.md.
        if (design.design?.id) {
          const tasksState = await pipeline.autoApproveDesignAndGenerateTasks(design.design.id)
          if (tasksState.tasks?.tasksPath) {
            state.files_written?.push(tasksState.tasks.tasksPath)
          }
        }
      }
      state.phase_status.sdd = 'done'
      state.blocked_reason = undefined
      await saveCheckpoint(root, state)
    } else if (phases.includes('sdd')) {
      return summarize(state, root, opts.format, {
        status: 'blocked',
        next_steps: [
          `Approve spec ${state.sdd.spec_id}`,
          `aio approval resolve / sdd_approve`,
          `bootstrap_product({ resume: true })`,
        ],
      })
    }
  }

  // --- interview (includes project scan) ---
  if (phases.includes('interview') && state.phase_status.interview !== 'done') {
    // Ingest AS-IS knowledge into the 3-layer vault here (vault phase already
    // ran, so raw/wiki/index/vector are wired). Best-effort; scan still returns
    // on embedder failure.
    const scan = await scanProject(root, { ingestToVault: true })
    state.project_scan_path = scan.scan_path
    const interview = await runHarnessInterview({
      projectRoot: root,
      answers: state.interview_answers,
      nonInteractive: opts.non_interactive === true || interviewEnabled === false,
      project_scan: scan,
      stackHints: {
        frontend: state.interview_answers?.frontend_framework,
        backend: state.interview_answers?.backend_framework,
      },
    })
    state.interview_answers = interview.answers
    if (interview.status === 'pending') {
      await saveCheckpoint(root, state)
      return summarize(state, root, opts.format, {
        status: 'pending',
        interview,
        next_steps: [
          'Answer the interview question (KO/EN)',
          'Re-call bootstrap_product with interview_answers merged',
        ],
      })
    }
    if (interview.status === 'error') {
      return summarize(state, root, opts.format, { status: 'error', interview })
    }
    // Persist rendered sections
    const aio = path.join(root, '.aio')
    await fs.mkdir(aio, { recursive: true })
    if (interview.rendered_tech_stack_section) {
      await fs.writeFile(
        path.join(aio, 'tech-stack.md'),
        interview.rendered_tech_stack_section,
        'utf-8'
      )
    }
    if (interview.rendered_architecture_section) {
      await fs.writeFile(
        path.join(aio, 'architecture-methodology.md'),
        interview.rendered_architecture_section,
        'utf-8'
      )
    }
    if (interview.rendered_rules_section) {
      await fs.writeFile(
        path.join(aio, 'language-rules.md'),
        interview.rendered_rules_section,
        'utf-8'
      )
    }
    state.phase_status.interview = 'done'
    await saveCheckpoint(root, state)
  }

  // --- harness ---
  if (phases.includes('harness') && state.phase_status.harness !== 'done') {
    const answers = state.interview_answers || {}
    let languageRules = ''
    try {
      languageRules = await fs.readFile(path.join(root, '.aio', 'language-rules.md'), 'utf-8')
    } catch {
      /* optional */
    }
    const boot = await bootstrapHarness(vault, {
      projectRoot: root,
      force: true,
      interview_answers: answers,
      language_rules_section: languageRules || undefined,
      profile: {
        domain: state.domain,
        description: state.description || '',
        stack: {
          frontend: answers.frontend_framework,
          backend: answers.backend_framework,
        },
      },
    })
    state.files_written = [...(state.files_written || []), ...boot.files.map((f) => f.path)]

    // Per-tool extra rule files
    await writeToolRuleFiles(root, answers)

    const skills = await writeCursorSkills(root, {
      profile: {
        name: 'default',
        domain: state.domain,
        description: state.description || '',
        stack: {
          frontend: answers.frontend_framework,
          backend: answers.backend_framework,
        },
      },
      answers,
      force: true,
    })
    state.files_written.push(...skills.map((s) => s.path))

    await designArchitecture(vault, getSearch(), `Architecture for ${state.domain}`, {
      answers: {
        frontend: answers.frontend_framework,
        backend: answers.backend_framework,
        scale: 'mvp',
        deployment: 'modular-monolith',
        team_size: 'solo',
        auth_model: 'jwt',
      },
      write_docs: true,
      skip_questions: true,
      project_root: root,
    }).catch(() => undefined)

    state.phase_status.harness = 'done'
    await saveCheckpoint(root, state)
  }

  // --- contracts + scaffold ---
  const scan = await scanProject(root).catch(() => ({ has_source: false as const }))
  if (
    (phases.includes('contracts') || phases.includes('scaffold')) &&
    state.phase_status.scaffold !== 'done'
  ) {
    const answers = state.interview_answers || {}
    const scaffold = await scaffoldApps({
      projectRoot: root,
      frontend: answers.frontend_tech_stack as never,
      backend: answers.backend_tech_stack as never,
      package_manager: answers.package_manager,
      monorepo_tool: answers.monorepo_tool,
      frontend_architecture: answers.frontend_architecture,
      backend_architecture: answers.backend_architecture,
      has_source: scan.has_source && !opts.force_scaffold,
      force: opts.force_scaffold === true,
      include_contracts: true,
    })
    state.files_written?.push(...scaffold.files.map((f) => f.path))
    state.phase_status.contracts = 'done'
    state.phase_status.scaffold = scaffold.skipped_reason ? 'skipped' : 'done'
    await saveCheckpoint(root, state)
  }

  // --- ci ---
  if (phases.includes('ci') && state.phase_status.ci !== 'done') {
    const ciFiles = await seedCi(root, false)
    state.files_written?.push(...ciFiles)
    state.phase_status.ci = 'done'
    await saveCheckpoint(root, state)
  }

  // --- implement ---
  if (phases.includes('implement') && state.phase_status.implement !== 'done') {
    const loop = await runImplementLoop({
      projectRoot: root,
      spec_id: state.sdd?.spec_id,
      dry_run: opts.non_interactive === true,
    })
    state.phase_status.implement = loop.ok ? 'done' : 'pending'
    await saveCheckpoint(root, state)
    return summarize(state, root, opts.format, {
      status: loop.ok ? 'complete' : 'partial',
      implement_loop: loop,
      next_steps: loop.next_steps,
    })
  }

  state.phase_status.implement =
    state.phase_status.implement === 'done'
      ? 'done'
      : phases.includes('implement')
        ? 'pending'
        : 'skipped'
  await saveCheckpoint(root, state)
  await events.emit('product.pipeline.done', { id: state.id })

  return summarize(state, root, opts.format, {
    status: 'complete',
    next_steps: [
      'domain_context({ task, format: "path" })',
      'run_implement_loop or plan_task → execute_dag',
      'file_back + lint_wiki',
    ],
  })
}

async function writeToolRuleFiles(root: string, answers: HarnessInterviewAnswers): Promise<void> {
  let tech = ''
  let arch = ''
  let rules = ''
  try {
    tech = await fs.readFile(path.join(root, '.aio', 'tech-stack.md'), 'utf-8')
    arch = await fs.readFile(path.join(root, '.aio', 'architecture-methodology.md'), 'utf-8')
    rules = await fs.readFile(path.join(root, '.aio', 'language-rules.md'), 'utf-8')
  } catch {
    /* optional */
  }
  const block = [tech, arch, rules].filter(Boolean).join('\n\n')
  const writes: Array<[string, string]> = [
    [path.join(root, '.cursor', 'rules', 'aio-tech-stack.mdc'), frontmatter('Tech stack') + tech],
    [
      path.join(root, '.cursor', 'rules', 'aio-architecture.mdc'),
      frontmatter('Architecture') + arch,
    ],
    [
      path.join(root, '.cursor', 'rules', 'aio-language-rules.mdc'),
      frontmatter('Language rules') + rules,
    ],
    [path.join(root, '.claude', 'rules', 'aio-tech-stack.md'), tech],
    [path.join(root, '.claude', 'rules', 'aio-architecture.md'), arch],
    [path.join(root, '.claude', 'rules', 'aio-language.md'), rules],
    [path.join(root, '.windsurf', 'rules', 'aio-tech-stack.md'), tech],
    [path.join(root, '.windsurf', 'rules', 'aio-architecture.md'), arch],
    [path.join(root, '.windsurf', 'rules', 'aio-language-rules.md'), rules],
    [path.join(root, '.continue', 'rules', 'aio-tech-stack.md'), tech],
    [path.join(root, '.continue', 'rules', 'aio-architecture.md'), arch],
    [path.join(root, '.continue', 'rules', 'aio-language-rules.md'), rules],
    [path.join(root, '.codex', 'AGENTS.md'), `# Codex harness\n\n${block}\n`],
  ]
  for (const [abs, body] of writes) {
    if (!body.trim()) continue
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, body, 'utf-8')
  }
  void answers
}

function frontmatter(desc: string): string {
  return `---\ndescription: ${desc}\nglobs:\nalwaysApply: true\n---\n\n`
}

function summarize(
  state: ProductPipelineState,
  root: string,
  format: 'path' | 'summary' | undefined,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const cp = checkpointPath(root)
  if (format === 'path') {
    return { ok: true, format: 'path', cache_path: cp, ...extra, phase_status: state.phase_status }
  }
  return {
    ok: true,
    domain: state.domain,
    checkpoint: cp,
    phase_status: state.phase_status,
    sdd: state.sdd,
    project_scan_path: state.project_scan_path,
    blocked_reason: state.blocked_reason,
    files_written_count: state.files_written?.length || 0,
    ...extra,
  }
}
