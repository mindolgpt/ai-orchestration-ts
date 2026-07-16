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
import { MCPServer } from "@/mcp/server";
import { DeepInterviewPlanner } from "@/orchestrator/planner";
import { DAGOrchestrator } from "@/orchestrator/dag-orchestrator";
import chalk from "chalk";
import Table from "cli-table3";

const program = new Command();

program
  .name("aio")
  .description("AI Orchestration System - 병렬 AI 오케스트레이션 CLI")
  .version("2.0.2");

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

    const embedder = createEmbedder();
    console.log(`  ✓ 임베딩 모델: ${process.env.EMBEDDING_MODEL || "auto"}`);

    const indexDir = resolveIndexDir(vaultPath);
    const search = new SemanticSearch(embedder, indexDir);
    await search.save();
    console.log(`  ✓ 검색 인덱스: ${indexDir}`);

    console.log(chalk.green("\n초기화 완료!"));
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

    const orchestrator = new DAGOrchestrator(3);

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