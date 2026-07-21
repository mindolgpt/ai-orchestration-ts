import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { bootstrapHarness } from '@/harness/bootstrap'
import {
  buildDomainContextPack,
  cacheContextPack,
  contextPackToMarkdown,
} from '@/harness/context-pack'
import { runDomainLoop, domainContext } from '@/harness/loop'
import { loadDomainProfile, saveDomainProfile } from '@/harness/profile'
import { getEventLog } from '@/observability/events'
import { routePrompt, routePromptToTool, listToolKeywords } from '@/harness/prompt-router'
import { detectStacksFromText } from '@/harness/stack-playbooks'
import { designArchitecture } from '@/harness/architecture'
import { brainstormDesign } from '@/harness/brainstorm'
import { seedStackPlaybooks, seedPatternPlaybooks } from '@/harness/seed-stacks'
import { ALL_STACK_IDS } from '@/harness/stack-playbooks'
import { executePromptRoute, PromptExecutorDeps } from '@/harness/prompt-executor'
import { workflowStepForTool } from '@/harness/workflow-steps'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

function json(data: unknown) {
  return jsonResult(data)
}

export type HarnessToolsContext = PromptExecutorDeps

export function registerHarnessTools(server: McpServer, ctx: HarnessToolsContext): void {
  const { vault, search, projectRoot: root } = ctx

  registerMcpTool(
    server,
    'aio_prompt',
    {
      description:
        "Keyword-based natural language router for ALL aio-mcp tools (Korean + English). Examples: 'wiki 검색 장바구니' / 'search the wiki for cart', '세션 띄워 API' / 'spawn a session', 'DAG 실행' / 'run the dag', 'ingest README.md'. execute defaults to true.",
      inputSchema: z.object({
        message: z.string(),
        execute: z.boolean().optional(),
        tool: z.string().optional(),
        targets: z
          .array(z.enum(['cursor', 'claude', 'opencode', 'codex', 'windsurf', 'continue', 'all']))
          .optional(),
        force: z.boolean().optional(),
        params: z.record(z.unknown()).optional(),
        answers: z
          .object({
            team_size: z.string().optional(),
            deployment: z
              .enum(['monolith', 'microservices', 'modular-monolith', 'serverless', 'unknown'])
              .optional(),
            scale: z.enum(['mvp', 'growth', 'enterprise']).optional(),
            auth_model: z.string().optional(),
            frontend: z.string().optional(),
            backend: z.string().optional(),
            mobile: z.string().optional(),
            notes: z.string().optional(),
            // brainstorm_design / architecture follow-ups
            phase: z.enum(['discovery', 'design', 'build', 'ship', 'operate']).optional(),
            consistency: z.enum(['strong', 'eventual', 'mixed']).optional(),
            traffic: z.enum(['low', 'medium', 'high']).optional(),
            team_experience: z.string().optional(),
            constraints: z.string().optional(),
            preferred_store: z.string().optional(),
          })
          .optional(),
      }),
    },
    async (args) => {
      const route = args.tool
        ? routePromptToTool(args.message, args.tool)
        : routePrompt(args.message)
      route.extracted_stacks = detectStacksFromText(args.message)

      // Merge router-extracted answers (phase/scale from message) with explicit args
      const mergedParams = {
        ...args.params,
        answers: {
          ...(typeof route.extracted_params?.answers === 'object'
            ? (route.extracted_params.answers as Record<string, unknown>)
            : {}),
          ...(typeof args.params?.answers === 'object'
            ? (args.params.answers as Record<string, unknown>)
            : {}),
          ...args.answers,
        },
      }
      if (
        mergedParams.answers &&
        typeof mergedParams.answers === 'object' &&
        !Object.keys(mergedParams.answers).length
      ) {
        delete (mergedParams as { answers?: unknown }).answers
      }

      const exec = await executePromptRoute(ctx, {
        route,
        message: args.message,
        execute: args.execute !== false,
        params: mergedParams,
        harness: {
          targets: args.targets,
          force: args.force,
          answers: mergedParams.answers,
        },
      })

      if (args.execute === false) {
        return json({
          routed: true,
          tool: route.tool,
          category: route.category,
          confidence: route.confidence,
          score: route.score,
          matched_keywords: route.matched_keywords,
          extracted_params: route.extracted_params,
          extracted_stacks: route.extracted_stacks,
          alternatives: route.alternatives,
          agent_hint: route.agent_hint,
          workflow_step: workflowStepForTool(route.tool),
          hint: 'Dry-run only. Omit execute or set execute:true to run (default: true).',
        })
      }

      await getEventLog(root).emit('harness.prompt', {
        tool: route.tool,
        executed: exec.executed,
      })

      return json({
        confidence: route.confidence,
        matched_keywords: route.matched_keywords,
        ...exec,
        tool: route.tool,
      })
    }
  )

  registerMcpTool(
    server,
    'list_tool_keywords',
    {
      description: 'List all MCP tools and their keyword triggers for aio_prompt routing',
      inputSchema: z.object({
        category: z
          .enum(['harness', 'wiki', 'session', 'dag', 'ops', 'branch', 'knowledge'])
          .optional(),
        mode: z.enum(['summary', 'full']).optional(),
      }),
    },
    async (args) => {
      const tools = listToolKeywords().filter((t) => !args.category || t.category === args.category)
      const mode = args.mode ?? 'summary'
      if (mode === 'summary') {
        return json({
          count: tools.length,
          tools: tools.map((t) => ({ id: t.id, category: t.category })),
        })
      }
      return json({
        count: tools.length,
        tools: tools.map((t) => ({
          id: t.id,
          category: t.category,
          keywords: t.keywords,
          hint: t.hint,
        })),
      })
    }
  )

  registerMcpTool(
    server,
    'bootstrap_harness',
    {
      description:
        "Generate domain harness for detected AI tool (default: auto-detect 1 client). Use targets:['all'] for every client. Keywords: 하네스 / harness setup / bootstrap harness.",
      inputSchema: z.object({
        targets: z
          .array(z.enum(['cursor', 'claude', 'opencode', 'codex', 'windsurf', 'continue', 'all']))
          .optional(),
        force: z.boolean().optional(),
        domain: z.string().optional(),
        description: z.string().optional(),
        backend: z.string().optional(),
        frontend: z.string().optional(),
        prompt: z.string().optional(),
      }),
    },
    async (args) => {
      const stacks = args.prompt ? detectStacksFromText(args.prompt) : {}
      const result = await bootstrapHarness(vault, {
        projectRoot: root,
        targets: args.targets,
        force: args.force,
        profile: {
          ...(args.domain ? { domain: args.domain } : {}),
          ...(args.description || args.prompt
            ? { description: args.description || args.prompt }
            : {}),
          stack: {
            ...(args.backend ? { backend: args.backend } : {}),
            ...(args.frontend ? { frontend: args.frontend } : {}),
            ...(stacks.backend ? { backend: stacks.backend } : {}),
            ...(stacks.frontend ? { frontend: stacks.frontend } : {}),
          },
        },
      })
      await getEventLog(root).emit('harness.bootstrap', {
        targets: result.targets,
        files: result.files.length,
      })
      return json(result)
    }
  )

  registerMcpTool(
    server,
    'seed_stack_playbooks',
    {
      description: `Seed vault/wiki/stacks/* playbooks (${ALL_STACK_IDS.length} stacks). Keywords: 스택 플레이북 / seed stack playbooks.`,
      inputSchema: z.object({
        stacks: z.array(z.string()).optional(),
        include_patterns: z.boolean().optional(),
      }),
    },
    async (args) => {
      const stacks = await seedStackPlaybooks(vault, search, args.stacks)
      const patterns =
        args.include_patterns !== false ? await seedPatternPlaybooks(vault, search) : { seeded: [] }
      return json({ stacks, patterns })
    }
  )

  registerMcpTool(
    server,
    'design_architecture',
    {
      description:
        'Wiki + stack playbook architecture design. Keywords: 아키텍처 / architecture design / design the architecture.',
      inputSchema: z.object({
        intent: z.string(),
        prompt: z.string().optional(),
        frontend: z.string().optional(),
        backend: z.string().optional(),
        mobile: z.string().optional(),
        write_docs: z.boolean().optional(),
        skip_questions: z.boolean().optional(),
        answers: z
          .object({
            team_size: z.string().optional(),
            deployment: z
              .enum(['monolith', 'microservices', 'modular-monolith', 'serverless', 'unknown'])
              .optional(),
            scale: z.enum(['mvp', 'growth', 'enterprise']).optional(),
            auth_model: z.string().optional(),
            data_stores: z.string().optional(),
            frontend: z.string().optional(),
            backend: z.string().optional(),
            mobile: z.string().optional(),
            notes: z.string().optional(),
          })
          .optional(),
      }),
    },
    async (args) => {
      const text = args.intent || args.prompt || ''
      const stacks = detectStacksFromText(text)
      const result = await designArchitecture(vault, search, text, {
        project_root: root,
        answers: args.answers,
        frontend: args.frontend || stacks.frontend || args.answers?.frontend,
        backend: args.backend || stacks.backend || args.answers?.backend,
        mobile: args.mobile || stacks.mobile || args.answers?.mobile,
        write_docs: args.write_docs,
        skip_questions: args.skip_questions,
      })
      await getEventLog(root).emit('harness.architecture', { status: result.status })
      return json(result)
    }
  )

  registerMcpTool(
    server,
    'brainstorm_design',
    {
      description:
        'Full-lifecycle dev brainstorm: planning, UX, visual design, domain, architecture, DB, algorithms, security, testing, DevOps, docs. Wiki-grounded options + trade-offs. Keywords: 브레인스토밍 / brainstorm / 기획 / help me design / UX design.',
      inputSchema: z.object({
        topic: z.string(),
        focus: z
          .array(
            z.enum([
              'planning',
              'ux',
              'visual_design',
              'domain',
              'architecture',
              'database',
              'algorithm',
              'api',
              'security',
              'performance',
              'testing',
              'devops',
              'observability',
              'documentation',
              'integration',
              'process',
              'general',
            ])
          )
          .optional(),
        skip_questions: z.boolean().optional(),
        write_docs: z.boolean().optional(),
        response_format: z.enum(['structured', 'markdown']).optional(),
        answers: z
          .object({
            scale: z.enum(['mvp', 'growth', 'enterprise']).optional(),
            consistency: z.enum(['strong', 'eventual', 'mixed']).optional(),
            traffic: z.enum(['low', 'medium', 'high']).optional(),
            team_experience: z.string().optional(),
            constraints: z.string().optional(),
            phase: z.enum(['discovery', 'design', 'build', 'ship', 'operate']).optional(),
            preferred_store: z.string().optional(),
          })
          .optional(),
      }),
    },
    async (args) => {
      const result = await brainstormDesign(vault, search, args.topic, {
        project_root: root,
        focus: args.focus,
        answers: args.answers,
        skip_questions: args.skip_questions,
        write_docs: args.write_docs,
        response_format: args.response_format,
      })
      await getEventLog(root).emit('harness.brainstorm', {
        topic: args.topic.slice(0, 80),
        status: result.status,
        options: result.options.length,
      })
      return json(result)
    }
  )

  registerMcpTool(
    server,
    'domain_context',
    {
      description:
        'Unified wiki domain context (preferred over bootstrap_domain / run_domain_loop). include_plan:true for full loop brief. format:path for lowest tokens (.aio/harness-context.json).',
      inputSchema: z.object({
        task: z.string(),
        top_k: z.number().optional(),
        extra_queries: z.array(z.string()).optional(),
        include_plan: z.boolean().optional(),
        format: z.enum(['json', 'markdown', 'path']).optional(),
      }),
    },
    async (args) => {
      const result = await domainContext(vault, search, args.task, {
        top_k: args.top_k,
        extra_queries: args.extra_queries,
        include_plan: args.include_plan,
        format: args.format ?? 'path',
        project_root: root,
      })
      await getEventLog(root).emit('harness.domain_context', { task: args.task.slice(0, 80) })
      return json(result)
    }
  )

  registerMcpTool(
    server,
    'bootstrap_domain',
    {
      description:
        'Build domain context pack from wiki. Prefer domain_context. Keywords: wiki 컨텍스트 / domain context / bootstrap domain.',
      inputSchema: z.object({
        task: z.string(),
        top_k: z.number().optional(),
        extra_queries: z.array(z.string()).optional(),
        format: z.enum(['json', 'markdown']).optional(),
      }),
    },
    async (args) => {
      const pack = await buildDomainContextPack(vault, search, args.task, {
        top_k: args.top_k,
        extra_queries: args.extra_queries,
        project_root: root,
      })
      const cachePath = await cacheContextPack(pack, root)
      await getEventLog(root).emit('harness.domain', {
        task: args.task.slice(0, 80),
        pages: pack.pages.length,
      })
      const body =
        args.format === 'markdown'
          ? { markdown: contextPackToMarkdown(pack), cache_path: cachePath }
          : { ...pack, cache_path: cachePath }
      return json({ ...body, deprecated: true, use_instead: 'domain_context' })
    }
  )

  registerMcpTool(
    server,
    'run_domain_loop',
    {
      description:
        'Full domain loop brief. Prefer domain_context with include_plan:true. format:path (default) returns cache path only.',
      inputSchema: z.object({
        task: z.string(),
        top_k: z.number().optional(),
        extra_queries: z.array(z.string()).optional(),
        include_plan: z.boolean().optional(),
        format: z.enum(['json', 'markdown', 'path']).optional(),
      }),
    },
    async (args) => {
      const result = await runDomainLoop(vault, search, args.task, {
        top_k: args.top_k,
        extra_queries: args.extra_queries,
        include_plan: args.include_plan,
        format: args.format ?? 'path',
        project_root: root,
      })
      await getEventLog(root).emit('harness.loop', { task: args.task.slice(0, 80) })
      return json({ ...result, deprecated: true, use_instead: 'domain_context' })
    }
  )

  registerMcpTool(
    server,
    'get_domain_profile',
    {
      description: 'Read .aio/domain-profile.yaml. Keywords: 도메인 프로필 / domain profile.',
      inputSchema: z.object({}),
    },
    async () => json(await loadDomainProfile(vault, root))
  )

  registerMcpTool(
    server,
    'save_domain_profile',
    {
      description: 'Save domain profile. Keywords: 프로필 저장 / save domain profile.',
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
      const { profile } = await loadDomainProfile(vault, root)
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
      }
      const saved = await saveDomainProfile(next, root)
      return json({ saved: true, path: saved, profile: next })
    }
  )

  registerMcpTool(
    server,
    'list_stack_playbooks',
    {
      description: 'List stack playbook ids. Keywords: 스택 목록 / list stack playbooks.',
      inputSchema: z.object({}),
    },
    async () =>
      json({
        count: ALL_STACK_IDS.length,
        stacks: ALL_STACK_IDS,
      })
  )
}

/** @deprecated use HarnessToolsContext */
export type HarnessToolsLegacy = (
  server: McpServer,
  vault: ObsidianVault,
  search: SemanticSearch,
  projectRoot?: string
) => void
