#!/usr/bin/env node

import { Command, OptionValues } from "commander";

interface InitOptions extends OptionValues {
  vault?: string;
  model?: string;
}

interface RecallOptions extends OptionValues {
  topK: string;
  vault?: string;
}

interface ServeOptions extends OptionValues {
  host: string;
  port: string;
  maxSessions: string;
  vault?: string;
}

interface McpServeOptions extends OptionValues {
  vault?: string;
  maxSessions: string;
}
import { ObsidianVault } from "@/knowledge/vault";
import { createEmbedder } from "@/knowledge/embedder";
import { SemanticSearch } from "@/knowledge/search";
import { resolveIndexDir, resolveProjectRoot, resolveVaultRoot } from "@/knowledge/paths";
import { lintWiki } from "@/knowledge/wiki-ops";
import { MCPServer } from "@/mcp/server";
import { DeepInterviewPlanner } from "@/orchestrator/planner";
import { DAGOrchestrator } from "@/orchestrator/dag-orchestrator";
import { bootstrapHarness } from "@/harness/bootstrap";
import { designArchitecture } from "@/harness/architecture";
import { routePrompt } from "@/harness/prompt-router";
import { createPromptExecutorDeps, executePromptRoute } from "@/harness/prompt-executor";
import { seedStackPlaybooks, seedPatternPlaybooks } from "@/harness/seed-stacks";
import { ALL_STACK_IDS } from "@/harness/stack-playbooks";
import { runDoctor, ONBOARDING_CHECKLIST } from "@/doctor/check";
import chalk from "chalk";
import Table from "cli-table3";

const program = new Command();

program
  .name("aio")
  .description("AI Orchestration System - 병렬 AI 오케스트레이션 CLI")
  .version("2.10.0");

program
  .command("init")
  .option("--vault <path>", "Obsidian vault 경로 (기본: <프로젝트>/vault)")
  .option("--model <model>", "임베딩 모델", "text-embedding-3-small")
  .description("프로젝트 초기화 - vault 생성, 임베딩 인덱스 준비")
  .action(async (options: InitOptions) => {
    console.log(chalk.bold.cyan("\n🚀 AI Orchestration System 초기화"));

    const projectRoot = resolveProjectRoot();
    const vaultPath = resolveVaultRoot(options.vault);
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();
    console.log(`  ✓ Project: ${projectRoot}`);
    console.log(`  ✓ Vault: ${vaultPath}`);
    console.log(`  ✓ Layers: raw/ + wiki/ + AGENTS.md (schema)`);

    const embedder = createEmbedder();
    console.log(`  ✓ 임베딩 모델: ${process.env.EMBEDDING_MODEL || "auto"}`);

    const indexDir = resolveIndexDir(vaultPath);
    const search = new SemanticSearch(embedder, indexDir);
    await search.save();
    console.log(`  ✓ 검색 인덱스: ${indexDir}`);

    console.log(chalk.green("\n초기화 완료!"));
    console.log(chalk.dim("  다음: aio bootstrap-harness → aio doctor"));
  });

program
  .command("doctor")
  .option("--vault <path>", "Obsidian vault 경로")
  .option("--json", "JSON 출력", false)
  .option("--fail", "fail/warn 있으면 exit 1 (CI)", false)
  .option("--skip-embed-test", "임베딩 스모크 테스트 생략", false)
  .description("프로젝트 온보딩·헬스 진단 (5분 체크리스트 검증)")
  .action(
    async (options: { vault?: string; json?: boolean; fail?: boolean; skipEmbedTest?: boolean }) => {
      const report = await runDoctor({
        vault: options.vault,
        skipEmbedTest: options.skipEmbedTest === true,
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(chalk.bold.cyan("\n🩺 aio doctor — onboarding & health"));
        console.log(`  Package: @mindol1004/aio-mcp@${report.package_version}`);
        console.log(`  Project: ${report.project_root}`);
        console.log(`  Vault:   ${report.vault_root}`);
        console.log(
          `  Harness: ${report.harness_target} (${report.harness_target_source})${report.harness_target_hint ? ` — ${report.harness_target_hint}` : ""}`
        );
        console.log(`  Status:  ${report.ok ? chalk.green("OK") : chalk.red("ISSUES")}\n`);

        const icon = (s: string) =>
          s === "ok" ? chalk.green("✓") : s === "warn" ? chalk.yellow("!") : chalk.red("✗");

        for (const c of report.checks) {
          console.log(`  ${icon(c.severity)} [${c.id}] ${c.message}`);
          if (c.fix) console.log(chalk.dim(`      → ${c.fix}`));
        }

        console.log(chalk.bold("\n📋 5-minute onboarding"));
        for (const item of ONBOARDING_CHECKLIST) {
          console.log(`  ${item.step}. ${chalk.cyan(item.cmd)}`);
          console.log(chalk.dim(`     ${item.note}`));
        }

        if (report.foreign_harness_files.length) {
          console.log(chalk.yellow(`\nForeign harness files (${report.foreign_harness_files.length} — other AI tools):`));
          for (const f of report.foreign_harness_files) {
            console.log(`  • [${f.target}] ${f.rel} — ${f.label}`);
          }
          console.log(chalk.dim("  Safe to delete if you only use " + report.harness_target));
        }

        if (report.next_steps.length) {
          console.log(chalk.bold.green("\nNext for this project:"));
          for (const s of report.next_steps) console.log(`  • ${s}`);
        }
      }

      if (options.fail && !report.ok) process.exitCode = 1;
    }
  );

program
  .command("bootstrap-harness")
  .option("--vault <path>", "Obsidian vault 경로")
  .option("--force", "기존 하네스 파일 덮어쓰기", false)
  .option(
    "--targets <list>",
    "cursor,claude,opencode,codex,windsurf,continue,all — 생략 시 AI 도구 자동 감지(1개)",
    undefined
  )
  .option("--domain <name>", "도메인 이름 (profile)")
  .option("--description <text>", "도메인 설명")
  .option("--backend <stack>", "예: spring-boot")
  .option("--frontend <stack>", "예: react")
  .description("wiki 기반 도메인 하네스 생성 (AGENTS.md, Cursor rules/hooks, MCP 설정)")
  .action(
    async (options: {
      vault?: string;
      force?: boolean;
      targets?: string;
      domain?: string;
      description?: string;
      backend?: string;
      frontend?: string;
    }) => {
      const vaultPath = resolveVaultRoot(options.vault);
      const vault = new ObsidianVault(vaultPath);
      await vault.initialize();

      const targets = options.targets
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean) as import("@/harness/types").HarnessTarget[];

      const result = await bootstrapHarness(vault, {
        targets: targets?.length ? targets : undefined,
        force: options.force === true,
        profile: {
          ...(options.domain ? { domain: options.domain } : {}),
          ...(options.description ? { description: options.description } : {}),
          stack: {
            ...(options.backend ? { backend: options.backend } : {}),
            ...(options.frontend ? { frontend: options.frontend } : {}),
          },
        },
      });

      console.log(chalk.bold.cyan("\n🔧 Domain harness bootstrap"));
      console.log(`  Project: ${result.project_root}`);
      if (result.target_detection) {
        console.log(
          `  Detected: ${result.target_detection.target} (${result.target_detection.source})`
        );
      }
      console.log(`  Vault:   ${result.vault_root}`);
      console.log(`  Targets: ${result.targets.join(", ")}`);
      console.log(chalk.bold("\nFiles:"));
      for (const f of result.files) {
        console.log(`  [${f.action}] ${f.path}`);
      }
      console.log(chalk.bold.green("\nNext:"));
      for (const s of result.next_steps) console.log(`  • ${s}`);
    }
  );

program
  .command("seed-stacks")
  .option("--vault <path>", "Obsidian vault 경로")
  .option("--stacks <list>", "특정 스택 id만 (쉼표 구분). 생략 시 전체")
  .option("--no-patterns", "아키텍처 패턴 페이지 제외")
  .description(`스택 플레이북 wiki 시드 (${ALL_STACK_IDS.length}개: React, Next, Vue, Spring, Kotlin, Express, FastAPI, Go, Rust, .NET, …)`)
  .action(async (options: { vault?: string; stacks?: string; patterns?: boolean }) => {
    const vaultPath = resolveVaultRoot(options.vault);
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();
    const embedder = createEmbedder();
    const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath));
    await search.load();

    const stackIds = options.stacks?.split(",").map((s) => s.trim()).filter(Boolean);
    const stacks = await seedStackPlaybooks(vault, search, stackIds);
    const patterns =
      options.patterns !== false ? await seedPatternPlaybooks(vault, search) : { seeded: [] };

    console.log(chalk.bold.cyan("\n📚 Stack playbooks seeded"));
    console.log(`  Seeded: ${stacks.seeded}, skipped: ${stacks.skipped}`);
    console.log(`  Patterns: ${patterns.seeded.join(", ") || "(none)"}`);
  });

program
  .command("design-architecture")
  .option("--vault <path>", "Obsidian vault 경로")
  .option("--intent <text>", "아키텍처 의도/프로젝트 설명")
  .option("--frontend <stack>", "예: react")
  .option("--backend <stack>", "예: spring-boot")
  .option("--mobile <stack>", "예: flutter")
  .option("--skip-questions", "Q&A 생략하고 바로 초안", false)
  .option("--team-size <n>", "팀 규모")
  .option("--deployment <mode>", "monolith|microservices|modular-monolith|serverless")
  .option("--scale <s>", "mvp|growth|enterprise")
  .option("--auth <model>", "JWT, OAuth2, …")
  .description("wiki + 스택 플레이북 기반 아키텍처 설계 (docs/architecture.md)")
  .action(
    async (options: {
      vault?: string;
      intent?: string;
      frontend?: string;
      backend?: string;
      mobile?: string;
      skipQuestions?: boolean;
      teamSize?: string;
      deployment?: string;
      scale?: string;
      auth?: string;
    }) => {
      const vaultPath = resolveVaultRoot(options.vault);
      const vault = new ObsidianVault(vaultPath);
      await vault.initialize();
      const embedder = createEmbedder();
      const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath));
      await search.load();

      const intent = options.intent || "프로젝트 아키텍처";
      const result = await designArchitecture(vault, search, intent, {
        frontend: options.frontend,
        backend: options.backend,
        mobile: options.mobile,
        skip_questions: options.skipQuestions === true,
        answers: {
          team_size: options.teamSize,
          deployment: options.deployment as import("@/harness/architecture").ArchitectureAnswers["deployment"],
          scale: options.scale as import("@/harness/architecture").ArchitectureAnswers["scale"],
          auth_model: options.auth,
        },
      });

      console.log(chalk.bold.cyan("\n🏗️ Architecture design"));
      console.log(`  Status: ${result.status}`);
      console.log(`  Stacks: ${JSON.stringify(result.detected_stacks)}`);
      if (result.status === "questions") {
        console.log(chalk.yellow("\nPending questions:"));
        for (const q of result.pending_questions) console.log(`  - [${q.id}] ${q.question}`);
      } else {
        console.log(`  Modules: ${result.modules.length}`);
        if (result.docs_written?.length) {
          console.log(chalk.green("\nWritten:"));
          for (const p of result.docs_written) console.log(`  • ${p}`);
        }
      }
      console.log(`\nNext: ${result.next_step}`);
    }
  );

program
  .command("aio-prompt <message>")
  .option("--vault <path>", "Obsidian vault 경로")
  .option("--execute", "키워드 매칭 후 자동 실행", false)
  .option("--tool <id>", "툴 강제 지정 (키워드 무시)")
  .option("--targets <list>", "harness targets (bootstrap 시)")
  .option("--force", "harness 덮어쓰기", false)
  .description("키워드 기반 자연어 라우팅 — wiki/세션/harness/dag 등 전체 MCP 툴")
  .action(
    async (
      message: string,
      options: {
        vault?: string;
        execute?: boolean;
        tool?: string;
        targets?: string;
        force?: boolean;
      }
    ) => {
      const route = options.tool
        ? (await import("@/harness/prompt-router")).routePromptToTool(message, options.tool)
        : routePrompt(message);

      console.log(chalk.bold.cyan("\n💬 aio_prompt (keyword router)"));
      console.log(`  Tool: ${route.tool} [${route.category || "-"}]`);
      console.log(`  Score: ${route.score} (${(route.confidence * 100).toFixed(0)}%)`);
      console.log(`  Keywords: ${route.matched_keywords.slice(0, 6).join(", ") || "(none)"}`);
      if (route.alternatives?.length) {
        console.log(
          chalk.dim(
            `  Alt: ${route.alternatives.map((a) => `${a.tool}(${a.score})`).join(", ")}`
          )
        );
      }
      console.log(`  Params: ${JSON.stringify(route.extracted_params)?.slice(0, 120)}…`);
      console.log(`  Hint: ${route.agent_hint}`);

      if (!options.execute) {
        console.log(chalk.dim("\nDry-run. Add --execute to run."));
        return;
      }

      const deps = createPromptExecutorDeps(options.vault);
      await deps.vault.initialize();
      await deps.search.load();

      const targets = options.targets
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean) as import("@/harness/types").HarnessTarget[];

      const exec = await executePromptRoute(deps, {
        route,
        message,
        execute: true,
        harness: { targets: targets?.length ? targets : undefined, force: options.force },
      });

      if (exec.executed) {
        console.log(chalk.green(`\n✓ Executed ${exec.tool}`));
        console.log(JSON.stringify(exec.result, null, 2).slice(0, 2000));
      } else {
        console.log(chalk.yellow(`\n✗ Not executed: ${exec.error || exec.hint}`));
      }
    }
  );

program
  .command("wiki-lint")
  .option("--vault <path>", "Obsidian vault 경로 (기본: <프로젝트>/vault)")
  .option("--deep", "심층 lint (broken links, stubs, stale, deprecated)", false)
  .option("--fail", "이슈가 있으면 exit code 1 (CI용)", false)
  .description("Wiki 구조 lint (orphans, index, schema, raw)")
  .action(async (options: { vault?: string; fail?: boolean; deep?: boolean }) => {
    const vaultPath = resolveVaultRoot(options.vault);
    const vault = new ObsidianVault(vaultPath);
    const result = await lintWiki(vault, { deep: options.deep === true });

    console.log(chalk.bold(`\nWiki lint — ${vaultPath}`));
    console.log(`  ok: ${result.ok}`);
    console.log(`  schema: ${result.schema_present}`);
    console.log(`  wiki pages: ${result.total_wiki_pages}`);
    console.log(`  raw sources: ${result.raw_count}`);
    console.log(`  orphans: ${result.orphan_count}`);
    console.log(`  index coverage: ${result.index_coverage} (${result.index_percent}%)`);

    if (result.deep) {
      console.log(`  broken links: ${result.deep.broken_links.length}`);
      console.log(`  stubs: ${result.deep.stubs.length}`);
      console.log(`  stale: ${result.deep.stale_pages.length}`);
      console.log(`  deprecated linked: ${result.deep.deprecated_still_linked.length}`);
    }

    if (result.issues.length) {
      console.log(chalk.yellow("\nIssues:"));
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
    } else {
      console.log(chalk.green("\nNo structural issues."));
    }

    if (options.fail && !result.ok) {
      process.exitCode = 1;
    }
  });

program
  .command("recall <query>")
  .option("--top-k <n>", "검색 결과 수", "10")
  .option("--vault <path>", "Obsidian vault 경로 (기본: <프로젝트>/vault)")
  .description("시맨틱 검색 (/recall) - 지식 베이스에서 의미 기반 검색")
  .action(async (query: string, options: RecallOptions) => {
    const vaultPath = resolveVaultRoot(options.vault);
    const embedder = createEmbedder();
    const search = new SemanticSearch(embedder, resolveIndexDir(vaultPath));
    await search.load();
    
    const results = await search.search(query, parseInt(options.topK));
    
    if (!results.length) {
      console.log(chalk.yellow("검색 결과 없음"));
      return;
    }

    const table = new Table({ head: ["#", "문서", "점수", "내용"] });
    results.forEach((r, i) => {
      table.push([String(i + 1), r.title, r.score.toFixed(3), r.snippet.slice(0, 60)]);
    });
    console.log(table.toString());
  });

program
  .command("serve")
  .option("--host <host>", "MCP 서버 호스트", "127.0.0.1")
  .option("--port <port>", "MCP 서버 포트", "8910")
  .option("--max-sessions <n>", "최대 병렬 세션", "5")
  .option("--vault <path>", "Obsidian vault 경로 (기본: <프로젝트>/vault)")
  .description("SSE 기반 MCP 서버 실행 (외부 MCP 클라이언트용)")
  .action(async (options: ServeOptions) => {
    const mcp = new MCPServer({
      maxSessions: parseInt(options.maxSessions),
      vaultPath: options.vault,
    });
    console.log(chalk.bold.cyan(`\n🔌 MCP 서버 시작 (SSE) - http://${options.host}:${options.port}/sse`));
    console.log(`  최대 병렬 세션: ${options.maxSessions}`);
    console.log(`  Vault: ${mcp.vaultRoot}`);
    console.log("  종료: Ctrl+C");
    await mcp.runSSE(options.host, parseInt(options.port));
  });

program
  .command("mcp-serve")
  .option("--vault <path>", "Obsidian vault 경로 (기본: <프로젝트>/vault)")
  .option("--max-sessions <n>", "최대 병렬 세션", "5")
  .description("stdio 기반 MCP 서버 실행 (Cursor/OpenCode 연결용)")
  .action(async (options: McpServeOptions) => {
    const server = new MCPServer({
      maxSessions: parseInt(options.maxSessions),
      vaultPath: options.vault,
    });
    await server.runStdio();
  });

program
  .command("status")
  .option("--vault <path>", "Obsidian vault 경로 (기본: <프로젝트>/vault)")
  .description("시스템 상태 확인")
  .action(async (options: { vault?: string }) => {
    const projectRoot = resolveProjectRoot();
    const vaultPath = resolveVaultRoot(options.vault);
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();
    const notes = await vault.listNotes();

    const table = new Table({ head: ["컴포넌트", "상태", "비고"] });
    table.push(["Project", "✓", projectRoot]);
    table.push(["Vault", "✓", `${vaultPath} (${notes.length}개 문서)`]);
    table.push(["검색 인덱스", "✓", resolveIndexDir(vaultPath)]);
    console.log(table.toString());
  });

program
  .command("example")
  .description("전체 파이프라인 예제 실행")
  .action(async () => {
    console.log(chalk.bold.cyan("\n📦 오케스트레이션 파이프라인 예제\n"));

    const planner = new DeepInterviewPlanner();
    const plan = planner.createPlan(
      "결제 시스템 리팩터링",
      "결제 모듈을 레거시에서 신규 시스템으로 마이그레이션",
      ["모든 결제 수단 지원", "기존 테스트 100% 통과", "성능 회귀 없음"],
      ["DB 스키마 변경 불가", "API 호환성 유지"]
    );

    const dag = planner.decomposeToDAG(plan, [
      ["T1", "공통 DTO 정의", []] as [string, string, string[]],
      ["T2", "DB 인터페이스 추상화", []] as [string, string, string[]],
      ["T3", "신규 결제 API", ["T1", "T2"]] as [string, string, string[]],
      ["T4", "레거시 어댑터", ["T2"]] as [string, string, string[]],
      ["T5", "통합 테스트", ["T3", "T4"]] as [string, string, string[]],
    ]);

    planner.printPlan(plan);

    const orchestrator = new DAGOrchestrator({ maxParallel: 3, enableVerify: false });

    const implementations = new Map<string, () => Promise<unknown>>([
      ["T1", async () => "DTO 정의 완료"],
      ["T2", async () => "DB 추상화 완료"],
      ["T3", async () => "API 구현 완료"],
      ["T4", async () => "어댑터 구현 완료"],
      ["T5", async () => "통합 테스트 통과"],
    ]);

    const results = await orchestrator.executeDAG(dag, implementations);

    console.log(chalk.bold.green("\n=== 결과 요약 ==="));
    for (const [id, result] of results) {
      console.log(`  ✓ ${id}: ${result}`);
    }
    console.log(`\n${orchestrator.summary()}`);
  });

program.parseAsync(process.argv).catch(console.error);