#!/usr/bin/env node

import * as fs from 'fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Command, OptionValues } from 'commander'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pkg: { version: string } = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')
)

interface InitOptions extends OptionValues {
  vault?: string
  model?: string
}

interface RecallOptions extends OptionValues {
  topK: string
  vault?: string
}

interface ServeOptions extends OptionValues {
  host: string
  port: string
  maxSessions: string
  vault?: string
}

interface McpServeOptions extends OptionValues {
  vault?: string
  maxSessions: string
}
import { ObsidianVault } from '@/knowledge/vault'
import { createEmbedder } from '@/knowledge/embedder'
import { SemanticSearch } from '@/knowledge/search'
import { resolveIndexDir, resolveProjectRoot, resolveVaultRoot } from '@/knowledge/paths'
import { lintWiki } from '@/knowledge/wiki-ops'
import { MCPServer } from '@/mcp/server'
import { DeepInterviewPlanner } from '@/orchestrator/planner'
import { DAGOrchestrator } from '@/orchestrator/dag-orchestrator'
import { bootstrapHarness } from '@/harness/bootstrap'
import { designArchitecture } from '@/harness/architecture'
import { routePrompt } from '@/harness/prompt-router'
import { createPromptExecutorDeps, executePromptRoute } from '@/harness/prompt-executor'
import { seedStackPlaybooks, seedPatternPlaybooks } from '@/harness/seed-stacks'
import { ALL_STACK_IDS } from '@/harness/stack-playbooks'
import { runDoctor, ONBOARDING_CHECKLIST } from '@/doctor/check'
import chalk from 'chalk'
import Table from 'cli-table3'

const program = new Command()

program
  .name('aio')
  .description('AI Orchestration System — parallel AI orchestration CLI')
  .version(pkg.version)

program
  .command('init')
  .option('--vault <path>', 'Obsidian vault path (default: <project>/vault)')
  .option('--model <model>', 'Embedding model', 'text-embedding-3-small')
  .description('Initialize project — create vault and embedding index')
  .action(async (options: InitOptions) => {
    console.log(chalk.bold.cyan('\n🚀 AI Orchestration System — init'))

    const projectRoot = resolveProjectRoot()
    const vaultPath = resolveVaultRoot(options.vault)
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    console.log(`  ✓ Project: ${projectRoot}`)
    console.log(`  ✓ Vault: ${vaultPath}`)
    console.log(`  ✓ Layers: raw/ + wiki/ + AGENTS.md (schema)`)

    console.log(`  ✓ Embedding model: ${process.env.EMBEDDING_MODEL || 'auto'}`)

    const indexDir = resolveIndexDir(vaultPath)
    await fs.mkdir(indexDir, { recursive: true })
    // Do NOT persist an empty FAISS index — empty meta.json + stub index.faiss
    // makes later add() fail/no-op and query_wiki returns 0 forever.
    console.log(`  ✓ Search index dir: ${indexDir}`)

    // Auto-reindex if wiki files already exist
    const existingNotes = (await vault.listNotes('wiki')).filter((p) => {
      const base = p.replace(/\\/g, '/')
      return base !== 'wiki/index' && base !== 'wiki/log'
    })
    if (existingNotes.length > 0) {
      console.log(
        chalk.dim(`  Found ${existingNotes.length} existing wiki page(s) — rebuilding index...`)
      )
      const embedder = createEmbedder()
      const search = new SemanticSearch(embedder, {
        indexDir,
        vaultRoot: vaultPath,
      })
      await search.load()
      for (const notePath of existingNotes) {
        const content = await vault.readNote(notePath)
        if (!content?.trim()) continue
        const title =
          content.match(/^#\s+(.+)$/m)?.[1]?.trim() || notePath.split(/[/\\]/).pop() || notePath
        await search.addDocument(notePath, title, content)
      }
      await search.save()
      console.log(chalk.green(`  ✓ Index rebuilt — ${existingNotes.length} documents`))
    } else {
      console.log(chalk.dim('    (vectors are created on first ingest / aio reindex)'))
    }

    console.log(chalk.green('\nInit complete!'))
    console.log(chalk.dim('  Next: aio bootstrap-harness → aio doctor'))
  })

program
  .command('reindex')
  .option('--vault <path>', 'Obsidian vault path')
  .description('Rebuild FAISS search index from existing vault/wiki notes')
  .action(async (options: { vault?: string }) => {
    console.log(chalk.bold.cyan('\n🔍 aio reindex — rebuild search index from wiki'))
    const vaultPath = resolveVaultRoot(options.vault)
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()

    const embedder = createEmbedder()
    const search = new SemanticSearch(embedder, {
      indexDir: resolveIndexDir(vaultPath),
      vaultRoot: vaultPath,
    })
    await search.load()

    const notes = (await vault.listNotes('wiki')).filter((p) => {
      const base = p.replace(/\\/g, '/')
      return base !== 'wiki/index' && base !== 'wiki/log'
    })

    console.log(`  Vault: ${vaultPath}`)
    console.log(`  Notes: ${notes.length}`)

    let ok = 0
    for (const notePath of notes) {
      const content = await vault.readNote(notePath)
      if (!content?.trim()) continue
      const title =
        content.match(/^#\s+(.+)$/m)?.[1]?.trim() || notePath.split(/[/\\]/).pop() || notePath
      await search.addDocument(notePath, title, content)
      ok++
      console.log(chalk.dim(`  + ${notePath}`))
    }

    await search.save()
    console.log(chalk.green(`\nReindex complete — ${ok} documents indexed`))
  })

program
  .command('doctor')
  .option('--vault <path>', 'Obsidian vault path')
  .option('--json', 'JSON output', false)
  .option('--fail', 'Exit 1 if any check has severity fail (CI; warns do not fail)', false)
  .option('--skip-embed-test', 'Skip embedding smoke test', false)
  .description('Onboarding and health diagnostics (5-minute checklist)')
  .action(
    async (options: {
      vault?: string
      json?: boolean
      fail?: boolean
      skipEmbedTest?: boolean
    }) => {
      const report = await runDoctor({
        vault: options.vault,
        skipEmbedTest: options.skipEmbedTest === true,
      })

      if (options.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        console.log(chalk.bold.cyan('\n🩺 aio doctor — onboarding & health'))
        console.log(`  Package: @mindol1004/aio-mcp@${report.package_version}`)
        console.log(`  Project: ${report.project_root}`)
        console.log(`  Vault:   ${report.vault_root}`)
        console.log(
          `  Harness: ${report.harness_target} (${report.harness_target_source})${report.harness_target_hint ? ` — ${report.harness_target_hint}` : ''}`
        )
        console.log(`  Status:  ${report.ok ? chalk.green('OK') : chalk.red('ISSUES')}\n`)

        const icon = (s: string) =>
          s === 'ok' ? chalk.green('✓') : s === 'warn' ? chalk.yellow('!') : chalk.red('✗')

        for (const c of report.checks) {
          console.log(`  ${icon(c.severity)} [${c.id}] ${c.message}`)
          if (c.fix) console.log(chalk.dim(`      → ${c.fix}`))
        }

        console.log(chalk.bold('\n📋 5-minute onboarding'))
        for (const item of ONBOARDING_CHECKLIST) {
          console.log(`  ${item.step}. ${chalk.cyan(item.cmd)}`)
          console.log(chalk.dim(`     ${item.note}`))
        }

        if (report.foreign_harness_files.length) {
          console.log(
            chalk.yellow(
              `\nForeign harness files (${report.foreign_harness_files.length} — other AI tools):`
            )
          )
          for (const f of report.foreign_harness_files) {
            console.log(`  • [${f.target}] ${f.rel} — ${f.label}`)
          }
          console.log(chalk.dim('  Safe to delete if you only use ' + report.harness_target))
        }

        if (report.next_steps.length) {
          console.log(chalk.bold.green('\nNext for this project:'))
          for (const s of report.next_steps) console.log(`  • ${s}`)
        }
      }

      if (options.fail && !report.ok) process.exitCode = 1
    }
  )

program
  .command('bootstrap-harness')
  .option('--vault <path>', 'Obsidian vault path')
  .option('--force', 'Overwrite existing harness files', false)
  .option(
    '--targets <list>',
    'cursor,claude,opencode,codex,windsurf,continue,all — omit to auto-detect one AI tool',
    undefined
  )
  .option('--domain <name>', 'Domain name (profile)')
  .option('--description <text>', 'Domain description')
  .option('--backend <stack>', 'e.g. spring-boot')
  .option('--frontend <stack>', 'e.g. react')
  .option('--prune-foreign', 'Delete harness files for other AI tools', false)
  .option('--dry-run-prune', 'Preview prune-foreign only', false)
  .description('Generate wiki-based domain harness (AGENTS.md, rules/hooks, MCP config)')
  .action(
    async (options: {
      vault?: string
      force?: boolean
      targets?: string
      domain?: string
      description?: string
      backend?: string
      frontend?: string
      pruneForeign?: boolean
      dryRunPrune?: boolean
    }) => {
      const vaultPath = resolveVaultRoot(options.vault)
      const vault = new ObsidianVault(vaultPath)
      await vault.initialize()

      const targets = options.targets
        ?.split(',')
        .map((t) => t.trim())
        .filter(Boolean) as import('@/harness/types').HarnessTarget[]

      const result = await bootstrapHarness(vault, {
        targets: targets?.length ? targets : undefined,
        force: options.force === true,
        prune_foreign: options.pruneForeign === true,
        dry_run_prune: options.dryRunPrune === true,
        profile: {
          ...(options.domain ? { domain: options.domain } : {}),
          ...(options.description ? { description: options.description } : {}),
          stack: {
            ...(options.backend ? { backend: options.backend } : {}),
            ...(options.frontend ? { frontend: options.frontend } : {}),
          },
        },
      })

      console.log(chalk.bold.cyan('\n🔧 Domain harness bootstrap'))
      console.log(`  Project: ${result.project_root}`)
      if (result.target_detection) {
        console.log(
          `  Detected: ${result.target_detection.target} (${result.target_detection.source})`
        )
      }
      console.log(`  Vault:   ${result.vault_root}`)
      console.log(`  Targets: ${result.targets.join(', ')}`)
      console.log(chalk.bold('\nFiles:'))
      for (const f of result.files) {
        console.log(`  [${f.action}] ${f.path}`)
      }
      console.log(chalk.bold.green('\nNext:'))
      for (const s of result.next_steps) console.log(`  • ${s}`)
    }
  )

program
  .command('ingest')
  .option('--vault <path>', 'Obsidian vault path')
  .option('--file <path>', 'Source text file path')
  .option('--title <title>', 'raw/wiki title')
  .option('--content <text>', 'Inline source text')
  .option('--concepts <json>', 'JSON array of {title, content?, subdir?}')
  .option('--no-lint', 'Skip lint_wiki', false)
  .option('--deep', 'Deep lint mode', false)
  .description('ingest_pipeline: raw → wiki concept(s) → lint')
  .action(
    async (options: {
      vault?: string
      file?: string
      title?: string
      content?: string
      concepts?: string
      noLint?: boolean
      deep?: boolean
    }) => {
      const vaultPath = resolveVaultRoot(options.vault)
      const vault = new ObsidianVault(vaultPath)
      await vault.initialize()
      const embedder = createEmbedder()
      const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath))
      await search.load()

      let concepts
      if (options.concepts) {
        concepts = JSON.parse(
          options.concepts
        ) as import('@/knowledge/wiki-ingest-pipeline').IngestConceptInput[]
      }

      const { ingestPipeline } = await import('@/knowledge/wiki-ingest-pipeline')
      const result = await ingestPipeline(vault, search, {
        title: options.title,
        content: options.content,
        file_path: options.file,
        concepts,
        run_lint: options.noLint !== true,
        lint_deep: options.deep === true,
        project_root: resolveProjectRoot(),
      })

      console.log(chalk.bold.cyan('\n📥 Ingest pipeline'))
      console.log(`  Raw: ${result.raw.path} (${result.raw.id})`)
      console.log(`  Wiki pages: ${result.wiki_pages.length}`)
      for (const p of result.wiki_pages) {
        console.log(`    • ${p.wiki_page}`)
      }
      if (result.lint) {
        const lint = result.lint as { ok?: boolean; issue_count?: number; issues?: unknown[] }
        if ('issue_count' in lint) {
          console.log(`  Lint ok: ${lint.ok} (${lint.issue_count} issues)`)
        } else if ('issues' in lint && Array.isArray(lint.issues)) {
          console.log(`  Lint ok: ${lint.ok} (${lint.issues.length} issues)`)
        }
      }
    }
  )

program
  .command('seed-stacks')
  .option('--vault <path>', 'Obsidian vault path')
  .option('--stacks <list>', 'Comma-separated stack ids (default: all)')
  .option('--no-patterns', 'Skip architecture pattern pages')
  .description(
    `Seed stack playbooks into wiki (${ALL_STACK_IDS.length}: React, Next, Vue, Spring, Kotlin, Express, FastAPI, Go, Rust, .NET, …)`
  )
  .action(async (options: { vault?: string; stacks?: string; patterns?: boolean }) => {
    const vaultPath = resolveVaultRoot(options.vault)
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    const embedder = createEmbedder()
    const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath))
    await search.load()

    const stackIds = options.stacks
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const stacks = await seedStackPlaybooks(vault, search, stackIds)
    const patterns =
      options.patterns !== false ? await seedPatternPlaybooks(vault, search) : { seeded: [] }

    console.log(chalk.bold.cyan('\n📚 Stack playbooks seeded'))
    console.log(`  Seeded: ${stacks.seeded}, skipped: ${stacks.skipped}`)
    console.log(`  Patterns: ${patterns.seeded.join(', ') || '(none)'}`)
  })

program
  .command('design-architecture')
  .option('--vault <path>', 'Obsidian vault path')
  .option('--intent <text>', 'Architecture intent / project description')
  .option('--frontend <stack>', 'e.g. react')
  .option('--backend <stack>', 'e.g. spring-boot')
  .option('--mobile <stack>', 'e.g. flutter')
  .option('--skip-questions', 'Skip Q&A and draft immediately', false)
  .option('--team-size <n>', 'Team size')
  .option('--deployment <mode>', 'monolith|microservices|modular-monolith|serverless')
  .option('--scale <s>', 'mvp|growth|enterprise')
  .option('--auth <model>', 'JWT, OAuth2, …')
  .description('Wiki + stack playbook architecture design (docs/architecture.md)')
  .action(
    async (options: {
      vault?: string
      intent?: string
      frontend?: string
      backend?: string
      mobile?: string
      skipQuestions?: boolean
      teamSize?: string
      deployment?: string
      scale?: string
      auth?: string
    }) => {
      const vaultPath = resolveVaultRoot(options.vault)
      const vault = new ObsidianVault(vaultPath)
      await vault.initialize()
      const embedder = createEmbedder()
      const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath))
      await search.load()

      const intent = options.intent || 'project architecture'
      const result = await designArchitecture(vault, search, intent, {
        frontend: options.frontend,
        backend: options.backend,
        mobile: options.mobile,
        skip_questions: options.skipQuestions === true,
        answers: {
          team_size: options.teamSize,
          deployment:
            options.deployment as import('@/harness/architecture').ArchitectureAnswers['deployment'],
          scale: options.scale as import('@/harness/architecture').ArchitectureAnswers['scale'],
          auth_model: options.auth,
        },
      })

      console.log(chalk.bold.cyan('\n🏗️ Architecture design'))
      console.log(`  Status: ${result.status}`)
      console.log(`  Stacks: ${JSON.stringify(result.detected_stacks)}`)
      if (result.status === 'questions') {
        console.log(chalk.yellow('\nPending questions:'))
        for (const q of result.pending_questions) console.log(`  - [${q.id}] ${q.question}`)
      } else {
        console.log(`  Modules: ${result.modules.length}`)
        if (result.docs_written?.length) {
          console.log(chalk.green('\nWritten:'))
          for (const p of result.docs_written) console.log(`  • ${p}`)
        }
      }
      console.log(`\nNext: ${result.next_step}`)
    }
  )

program
  .command('aio-prompt <message>')
  .option('--vault <path>', 'Obsidian vault path')
  .option('--execute', 'Auto-execute after keyword match', false)
  .option('--tool <id>', 'Force tool id (ignore keywords)')
  .option('--targets <list>', 'Harness targets (when bootstrapping)')
  .option('--force', 'Overwrite harness files', false)
  .description('Keyword natural-language routing across MCP tools')
  .action(
    async (
      message: string,
      options: {
        vault?: string
        execute?: boolean
        tool?: string
        targets?: string
        force?: boolean
      }
    ) => {
      const route = options.tool
        ? (await import('@/harness/prompt-router')).routePromptToTool(message, options.tool)
        : routePrompt(message)

      console.log(chalk.bold.cyan('\n💬 aio_prompt (keyword router)'))
      console.log(`  Tool: ${route.tool} [${route.category || '-'}]`)
      console.log(`  Score: ${route.score} (${(route.confidence * 100).toFixed(0)}%)`)
      console.log(`  Keywords: ${route.matched_keywords.slice(0, 6).join(', ') || '(none)'}`)
      if (route.alternatives?.length) {
        console.log(
          chalk.dim(`  Alt: ${route.alternatives.map((a) => `${a.tool}(${a.score})`).join(', ')}`)
        )
      }
      console.log(`  Params: ${JSON.stringify(route.extracted_params)?.slice(0, 120)}…`)
      console.log(`  Hint: ${route.agent_hint}`)

      if (!options.execute) {
        console.log(chalk.dim('\nDry-run. Add --execute to run.'))
        return
      }

      const deps = createPromptExecutorDeps(options.vault)
      await deps.vault.initialize()
      await deps.search.load()

      const targets = options.targets
        ?.split(',')
        .map((t) => t.trim())
        .filter(Boolean) as import('@/harness/types').HarnessTarget[]

      const exec = await executePromptRoute(deps, {
        route,
        message,
        execute: true,
        harness: { targets: targets?.length ? targets : undefined, force: options.force },
      })

      if (exec.executed) {
        console.log(chalk.green(`\n✓ Executed ${exec.tool}`))
        console.log(JSON.stringify(exec.result, null, 2).slice(0, 2000))
      } else {
        console.log(chalk.yellow(`\n✗ Not executed: ${exec.error || exec.hint}`))
      }
    }
  )

program
  .command('watch-raw')
  .option('--vault <path>', 'Obsidian vault path')
  .option('--subdir <name>', 'Wiki taxonomy subdir (domain, engineering, …)', 'domain')
  .option('--poll <ms>', 'Poll interval in ms', '5000')
  .description('Watch vault/raw-inbox/ and run ingest_pipeline')
  .action(async (options: { vault?: string; subdir?: string; poll?: string }) => {
    const vaultPath = resolveVaultRoot(options.vault)
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    const embedder = createEmbedder()
    const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath))
    await search.load()

    const { watchRawInbox, rawInboxDir, ensureRawInbox } = await import('@/knowledge/raw-inbox')
    await ensureRawInbox(vaultPath)

    console.log(chalk.bold.cyan('\n👀 Raw inbox watcher'))
    console.log(`  Inbox: ${rawInboxDir(vaultPath)}`)
    console.log(`  Drop .md/.txt files here — auto ingest → processed/`)
    console.log(chalk.dim('  Ctrl+C to stop\n'))

    const handle = await watchRawInbox({
      vault,
      search,
      project_root: resolveProjectRoot(),
      subdir: options.subdir,
      poll_ms: parseInt(options.poll || '5000', 10),
      onProcessed: (results) => {
        for (const r of results) {
          if (r.ok) {
            console.log(
              chalk.green(`  ✓ ${r.file} → raw:${r.raw_id} wiki:${r.wiki_pages?.join(', ')}`)
            )
          } else {
            console.log(chalk.red(`  ✗ ${r.file}: ${r.error}`))
          }
        }
      },
    })

    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        handle.stop()
        resolve()
      })
    })
  })

program
  .command('dashboard')
  .option('--host <host>', 'Host', '127.0.0.1')
  .option('--port <port>', 'Port', '8920')
  .option('--vault <path>', 'Obsidian vault path')
  .description(
    'Wiki coverage · proposals · raw inbox · events dashboard. Non-localhost bind requires AIO_DASHBOARD_TOKEN.'
  )
  .action(async (options: { host?: string; port?: string; vault?: string }) => {
    const vaultPath = resolveVaultRoot(options.vault)
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    const embedder = createEmbedder()
    const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath))
    await search.load()
    const { startDashboardServer } = await import('@/dashboard/server')
    const { url, close } = await startDashboardServer({
      host: options.host || '127.0.0.1',
      port: parseInt(options.port || '8920', 10),
      vault,
      search,
      projectRoot: resolveProjectRoot(),
    })

    console.log(chalk.bold.cyan(`\n📊 Dashboard — ${url}`))
    console.log(chalk.dim('  Local apply/reject · scan-inbox · Ctrl+C to stop'))
    if (process.env.AIO_DASHBOARD_TOKEN) {
      console.log(chalk.dim('  Auth: AIO_DASHBOARD_TOKEN (Bearer / X-Aio-Token / ?token=)'))
    }
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        close().then(resolve).catch(console.error)
      })
    })
  })

async function printVaultList(): Promise<void> {
  const { listVaultEntries, loadVaultRegistry } = await import('@/knowledge/vault-registry')
  const root = resolveProjectRoot()
  const reg = await loadVaultRegistry(root)
  const entries = await listVaultEntries(root)
  console.log(chalk.bold.cyan('\n🗂️ Vault registry'))
  console.log(`  Default: ${reg.default}`)
  console.log(
    chalk.dim(
      `  Active at MCP start: AIO_VAULT_NAME=${process.env.AIO_VAULT_NAME || '(default)'} — restart MCP after changing`
    )
  )
  for (const v of entries) {
    console.log(`  • ${v.name} → ${v.path}${v.domain ? ` (${v.domain})` : ''}`)
  }
}

async function registerVaultCli(options: {
  name: string
  path: string
  domain?: string
  default?: boolean
}): Promise<void> {
  const { registerVault } = await import('@/knowledge/vault-registry')
  const reg = await registerVault(
    {
      name: options.name,
      path: options.path,
      domain: options.domain,
      default: options.default === true,
    },
    resolveProjectRoot()
  )
  console.log(chalk.green(`\n✓ Registered vault "${options.name}" (default: ${reg.default})`))
  console.log(
    chalk.dim(
      '  Tip: set AIO_VAULT_NAME and restart the MCP server to activate a non-default vault.'
    )
  )
}

const vaultCmd = program
  .command('vault')
  .description('Multi-vault registry (.aio/vaults.yaml). Subcommands: list, register')

vaultCmd.command('list').description('List registered vaults').action(printVaultList)

vaultCmd
  .command('register')
  .requiredOption('--name <name>', 'vault id')
  .requiredOption('--path <path>', 'relative or absolute path')
  .option('--domain <domain>', 'domain label')
  .option('--default', 'set as default vault', false)
  .description('Register a vault in vaults.yaml')
  .action(registerVaultCli)

// Backward-compatible aliases
program.command('vault-list').description('Alias for `aio vault list`').action(printVaultList)
program
  .command('vault-register')
  .requiredOption('--name <name>', 'vault id')
  .requiredOption('--path <path>', 'relative or absolute path')
  .option('--domain <domain>', 'domain label')
  .option('--default', 'set as default vault', false)
  .description('Alias for `aio vault register`')
  .action(registerVaultCli)

program
  .command('scan-inbox')
  .option('--vault <path>', 'Obsidian vault path')
  .option('--subdir <name>', 'wiki subdir', 'domain')
  .description('One-shot raw-inbox scan (same as MCP scan_raw_inbox)')
  .action(async (options: { vault?: string; subdir?: string }) => {
    const vaultPath = resolveVaultRoot(options.vault)
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    const embedder = createEmbedder()
    const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath))
    await search.load()
    const { scanRawInbox } = await import('@/knowledge/raw-inbox')
    const result = await scanRawInbox(vault, search, {
      project_root: resolveProjectRoot(),
      subdir: options.subdir,
    })
    console.log(chalk.bold.cyan('\n📥 Raw inbox scan'))
    for (const p of result.processed) {
      console.log(p.ok ? chalk.green(`  ✓ ${p.file}`) : chalk.red(`  ✗ ${p.file}: ${p.error}`))
    }
    if (!result.processed.length) console.log(chalk.dim('  (no pending files)'))
  })

program
  .command('wiki-lint')
  .option('--vault <path>', 'Obsidian vault path (default: <project>/vault)')
  .option('--deep', 'Deep lint (broken links, stubs, stale, deprecated)', false)
  .option('--fail', 'Exit 1 if issues found (CI)', false)
  .description('Wiki structure lint (orphans, index, schema, raw)')
  .action(async (options: { vault?: string; fail?: boolean; deep?: boolean }) => {
    const vaultPath = resolveVaultRoot(options.vault)
    const vault = new ObsidianVault(vaultPath)
    const result = await lintWiki(vault, { deep: options.deep === true })

    console.log(chalk.bold(`\nWiki lint — ${vaultPath}`))
    console.log(`  ok: ${result.ok}`)
    console.log(`  schema: ${result.schema_present}`)
    console.log(`  wiki pages: ${result.total_wiki_pages}`)
    console.log(`  raw sources: ${result.raw_count}`)
    console.log(`  orphans: ${result.orphan_count}`)
    console.log(`  index coverage: ${result.index_coverage} (${result.index_percent}%)`)

    if (result.deep) {
      console.log(`  broken links: ${result.deep.broken_links.length}`)
      console.log(`  stubs: ${result.deep.stubs.length}`)
      console.log(`  stale: ${result.deep.stale_pages.length}`)
      console.log(`  deprecated linked: ${result.deep.deprecated_still_linked.length}`)
    }

    if (result.issues.length) {
      console.log(chalk.yellow('\nIssues:'))
      for (const issue of result.issues) {
        console.log(`  - ${issue}`)
      }
    } else {
      console.log(chalk.green('\nNo structural issues.'))
    }

    if (options.fail && !result.ok) {
      process.exitCode = 1
    }
  })

program
  .command('recall <query>')
  .option('--top-k <n>', 'Number of results', '10')
  .option('--vault <path>', 'Obsidian vault path (default: <project>/vault)')
  .description('Semantic search over the knowledge base')
  .action(async (query: string, options: RecallOptions) => {
    const vaultPath = resolveVaultRoot(options.vault)
    const embedder = createEmbedder()
    const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath))
    await search.load()

    const results = await search.search(query, parseInt(options.topK))

    if (!results.length) {
      console.log(chalk.yellow('No search results'))
      return
    }

    const table = new Table({ head: ['#', 'Document', 'Score', 'Snippet'] })
    results.forEach((r, i) => {
      table.push([String(i + 1), r.title, r.score.toFixed(3), r.snippet.slice(0, 60)])
    })
    console.log(table.toString())
  })

program
  .command('serve')
  .option('--host <host>', 'MCP server host', '127.0.0.1')
  .option('--port <port>', 'MCP server port', '8910')
  .option('--max-sessions <n>', 'Max parallel sessions', '5')
  .option('--vault <path>', 'Obsidian vault path (default: <project>/vault)')
  .description(
    'Run SSE MCP server for external clients. Non-localhost bind requires AIO_SSE_TOKEN.'
  )
  .action(async (options: ServeOptions) => {
    const mcp = new MCPServer({
      maxSessions: parseInt(options.maxSessions),
      vaultPath: options.vault,
    })
    console.log(
      chalk.bold.cyan(`\n🔌 MCP server (SSE) — http://${options.host}:${options.port}/sse`)
    )
    console.log(`  Max parallel sessions: ${options.maxSessions}`)
    console.log(`  Vault: ${mcp.vaultRoot}`)
    if (process.env.AIO_SSE_TOKEN) {
      console.log(chalk.dim('  Auth: AIO_SSE_TOKEN (Bearer / X-Aio-Token / ?token=)'))
    }
    console.log('  Stop: Ctrl+C')
    await mcp.runSSE(options.host, parseInt(options.port))
  })

const approvalCmd = program.command('approval').description('Human-in-the-loop approval gate')

approvalCmd
  .command('list')
  .option('--status <status>', 'pending|approved|rejected|expired')
  .description('List approval requests')
  .action(async (options: { status?: string }) => {
    const { ApprovalGate } = await import('@/orchestrator/approval')
    const gate = new ApprovalGate()
    await gate.load()
    const status = options.status as 'pending' | 'approved' | 'rejected' | 'expired' | undefined
    const rows = gate.list(status)
    if (!rows.length) {
      console.log(chalk.dim('(no approvals)'))
      return
    }
    const table = new Table({ head: ['id', 'status', 'risk', 'action', 'reason'] })
    for (const a of rows) {
      table.push([a.id, a.status, a.risk, a.action, a.reason.slice(0, 60)])
    }
    console.log(table.toString())
  })

approvalCmd
  .command('resolve')
  .argument('<id>', 'approval id')
  .option('--approve', 'approve the request')
  .option('--reject', 'reject the request')
  .description('Resolve an approval from the local CLI (trusted; no confirm_code needed)')
  .action(async (id: string, options: { approve?: boolean; reject?: boolean }) => {
    if (!!options.approve === !!options.reject) {
      console.error(chalk.red('Specify exactly one of --approve or --reject'))
      process.exitCode = 1
      return
    }
    const { ApprovalGate } = await import('@/orchestrator/approval')
    const gate = new ApprovalGate()
    await gate.load()
    const result = await gate.resolve(id, !!options.approve, 'cli', { trustedLocal: true })
    console.log(JSON.stringify(result, null, 2))
    if ('error' in result) process.exitCode = 1
  })

program
  .command('mcp-serve')
  .option('--vault <path>', 'Obsidian vault path (default: <project>/vault)')
  .option('--max-sessions <n>', 'Max parallel sessions', '5')
  .description('Run stdio MCP server (Cursor / OpenCode)')
  .action(async (options: McpServeOptions) => {
    const server = new MCPServer({
      maxSessions: parseInt(options.maxSessions),
      vaultPath: options.vault,
    })
    await server.runStdio()
  })

program
  .command('status')
  .option('--vault <path>', 'Obsidian vault path (default: <project>/vault)')
  .description('Show project / vault / index paths')
  .action(async (options: { vault?: string }) => {
    const projectRoot = resolveProjectRoot()
    const vaultPath = resolveVaultRoot(options.vault)
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    const notes = await vault.listNotes()

    const { resolveVectorStoreKind } = await import('@/knowledge/vector-store')
    const storeKind = resolveVectorStoreKind()
    const storeDetail =
      storeKind === 'faiss'
        ? resolveIndexDir(vaultPath)
        : storeKind === 'qdrant'
          ? `qdrant ${process.env.QDRANT_URL || 'http://127.0.0.1:6333'}`
          : storeKind === 'chroma'
            ? `chroma ${process.env.CHROMA_URL || 'http://127.0.0.1:8000'}`
            : storeKind === 'weaviate'
              ? `weaviate ${process.env.WEAVIATE_URL || 'http://127.0.0.1:8080'}`
              : storeKind === 'pinecone'
                ? `pinecone index=${process.env.PINECONE_INDEX || 'auto'}`
                : storeKind === 'pgvector'
                  ? 'pgvector DATABASE_URL'
                  : storeKind
    const table = new Table({ head: ['Component', 'Status', 'Detail'] })
    table.push(['Project', '✓', projectRoot])
    table.push(['Vault', '✓', `${vaultPath} (${notes.length} notes)`])
    table.push(['Vector store', '✓', storeDetail])
    console.log(table.toString())
  })

program
  .command('example')
  .description('Run a full orchestration pipeline demo')
  .action(async () => {
    console.log(chalk.bold.cyan('\n📦 Orchestration pipeline example\n'))

    const planner = new DeepInterviewPlanner()
    const plan = planner.createPlan(
      'Payment system refactor',
      'Migrate the payment module from legacy to the new system',
      ['Support all payment methods', 'Keep existing tests green', 'No performance regression'],
      ['No DB schema changes', 'Maintain API compatibility']
    )

    const dag = planner.decomposeToDAG(plan, [
      ['T1', 'Define shared DTOs', []] as [string, string, string[]],
      ['T2', 'Abstract DB interface', []] as [string, string, string[]],
      ['T3', 'New payment API', ['T1', 'T2']] as [string, string, string[]],
      ['T4', 'Legacy adapter', ['T2']] as [string, string, string[]],
      ['T5', 'Integration tests', ['T3', 'T4']] as [string, string, string[]],
    ])

    planner.printPlan(plan)

    const orchestrator = new DAGOrchestrator({ maxParallel: 3, enableVerify: false })

    const implementations = new Map<string, () => Promise<unknown>>([
      ['T1', async () => 'DTOs defined'],
      ['T2', async () => 'DB abstraction done'],
      ['T3', async () => 'API implemented'],
      ['T4', async () => 'Adapter implemented'],
      ['T5', async () => 'Integration tests passed'],
    ])

    const results = await orchestrator.executeDAG(dag, implementations)

    console.log(chalk.bold.green('\n=== Result summary ==='))
    for (const [id, result] of results) {
      console.log(`  ✓ ${id}: ${result}`)
    }
    console.log(`\n${orchestrator.summary()}`)
  })

program.parseAsync(process.argv).catch(console.error)
