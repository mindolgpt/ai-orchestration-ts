import * as fs from "fs/promises";
import * as fsSync from "fs";
import { fileURLToPath } from "url";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveProjectRoot, resolveVaultRoot, resolveIndexDir } from "@/knowledge/paths";
import { ObsidianVault } from "@/knowledge/vault";
import { listSessionRuntimes } from "@/mcp/session-runtime";

const execFileAsync = promisify(execFile);

export type DoctorSeverity = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  severity: DoctorSeverity;
  message: string;
  detail?: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  project_root: string;
  vault_root: string;
  package_version: string;
  checks: DoctorCheck[];
  next_steps: string[];
  onboarding_minutes: number;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  const bin = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(bin, [cmd], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

export async function runDoctor(opts?: {
  vault?: string;
  projectRoot?: string;
  skipEmbedTest?: boolean;
}): Promise<DoctorReport> {
  const projectRoot = path.resolve(opts?.projectRoot || resolveProjectRoot());
  const vaultRoot = opts?.vault
    ? resolveVaultRoot(opts.vault)
    : path.join(projectRoot, "vault");
  const checks: DoctorCheck[] = [];
  const next_steps: string[] = [];

  // Node
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  checks.push({
    id: "node",
    severity: nodeMajor >= 20 ? "ok" : "fail",
    message: `Node.js ${process.versions.node}`,
    fix: nodeMajor < 20 ? "Upgrade to Node.js >= 20" : undefined,
  });

  // Project root env
  const aioRoot = process.env.AIO_PROJECT_ROOT;
  if (aioRoot && path.resolve(aioRoot) !== projectRoot) {
    checks.push({
      id: "aio_project_root",
      severity: "warn",
      message: `AIO_PROJECT_ROOT=${aioRoot} differs from detected ${projectRoot}`,
      fix: "Align AIO_PROJECT_ROOT with your workspace folder in MCP config",
    });
  } else if (!aioRoot) {
    checks.push({
      id: "aio_project_root",
      severity: "warn",
      message: "AIO_PROJECT_ROOT not set (using cwd walk-up detection)",
      fix: 'Set env AIO_PROJECT_ROOT in .cursor/mcp.json: "${workspaceFolder}"',
    });
  } else {
    checks.push({
      id: "aio_project_root",
      severity: "ok",
      message: `AIO_PROJECT_ROOT=${projectRoot}`,
    });
  }

  // Vault
  const vaultOk = await pathExists(vaultRoot);
  checks.push({
    id: "vault",
    severity: vaultOk ? "ok" : "fail",
    message: vaultOk ? `Vault: ${vaultRoot}` : `Vault missing: ${vaultRoot}`,
    fix: vaultOk ? undefined : "Run: aio init",
  });
  if (!vaultOk) next_steps.push("aio init");

  let wikiPages = 0;
  if (vaultOk) {
    try {
      const vault = new ObsidianVault(vaultRoot);
      await vault.initialize();
      const notes = await vault.listNotes();
      wikiPages = notes.filter((n) => n.startsWith("wiki/")).length;
      checks.push({
        id: "wiki_pages",
        severity: wikiPages >= 3 ? "ok" : wikiPages > 0 ? "warn" : "warn",
        message: `Wiki pages: ${wikiPages}`,
        detail: wikiPages < 3 ? "brainstorm/query quality improves with more domain wiki" : undefined,
        fix: wikiPages < 3 ? "ingest_source or copy domain notes into vault/wiki/" : undefined,
      });
    } catch (err) {
      checks.push({
        id: "wiki_pages",
        severity: "warn",
        message: "Could not list wiki notes",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Index
  const indexDir = resolveIndexDir(vaultRoot);
  const metaPath = path.join(indexDir, "meta.json");
  const faissPath = path.join(indexDir, "index.faiss");
  const hasMeta = await pathExists(metaPath);
  const hasFaiss = await pathExists(faissPath);
  checks.push({
    id: "search_index",
    severity: hasMeta && hasFaiss ? "ok" : hasMeta ? "warn" : "fail",
    message: hasMeta && hasFaiss ? `Search index: ${indexDir}` : `Index incomplete: ${indexDir}`,
    fix: !hasMeta ? "Run: aio init (or recall once to build index)" : undefined,
  });

  // Harness
  const harnessFiles = [
    { id: "agents_md", path: path.join(projectRoot, "AGENTS.md"), cmd: "aio bootstrap-harness" },
    {
      id: "cursor_rule",
      path: path.join(projectRoot, ".cursor", "rules", "aio-domain-harness.mdc"),
      cmd: "aio bootstrap-harness",
    },
    {
      id: "domain_profile",
      path: path.join(projectRoot, ".aio", "domain-profile.yaml"),
      cmd: "aio bootstrap-harness",
    },
  ];
  for (const h of harnessFiles) {
    const exists = await pathExists(h.path);
    checks.push({
      id: h.id,
      severity: exists ? "ok" : "warn",
      message: exists ? path.relative(projectRoot, h.path) : `Missing: ${path.relative(projectRoot, h.path)}`,
      fix: exists ? undefined : `Run: ${h.cmd}`,
    });
  }
  if (!(await pathExists(path.join(projectRoot, "AGENTS.md")))) {
    next_steps.push("aio bootstrap-harness");
  }

  // MCP config
  const mcpPath = path.join(projectRoot, ".cursor", "mcp.json");
  const mcp = await readJsonSafe<{ mcpServers?: Record<string, { command?: string; args?: string[] }> }>(
    mcpPath
  );
  const hasAioMcp =
    mcp?.mcpServers &&
    Object.entries(mcp.mcpServers).some(
      ([, s]) =>
        s.args?.some((a) => a.includes("aio-mcp") || a.includes("@mindol1004/aio-mcp")) ||
        s.command === "aio"
    );
  checks.push({
    id: "cursor_mcp",
    severity: hasAioMcp ? "ok" : mcp ? "warn" : "warn",
    message: hasAioMcp
      ? ".cursor/mcp.json includes aio-mcp"
      : mcp
        ? ".cursor/mcp.json exists but aio-mcp server not found"
        : "No .cursor/mcp.json (bootstrap-harness can merge it)",
    fix: hasAioMcp ? undefined : "aio bootstrap-harness && reload MCP in Cursor",
  });

  // Git
  const gitDir = path.join(projectRoot, ".git");
  checks.push({
    id: "git",
    severity: (await pathExists(gitDir)) ? "ok" : "warn",
    message: (await pathExists(gitDir)) ? "Git repository detected" : "Not a git repo (worktree/branch hunt limited)",
    fix: (await pathExists(gitDir)) ? undefined : "git init (optional, for worktree isolation)",
  });

  // ripgrep
  const hasRg = await commandExists("rg");
  checks.push({
    id: "ripgrep",
    severity: hasRg ? "ok" : "warn",
    message: hasRg ? "ripgrep (rg) available" : "ripgrep not found",
    fix: hasRg ? undefined : "Install ripgrep or set AIO_DISABLE_RG=1",
  });

  // Session runtime
  const runtime = process.env.AIO_SESSION_RUNTIME || "opencode";
  const runtimes = listSessionRuntimes();
  const spec = runtimes.find((r) => r.id === runtime) || runtimes[0];
  const sessionBinOk = await commandExists(spec.command);
  checks.push({
    id: "session_runtime",
    severity: sessionBinOk ? "ok" : "warn",
    message: sessionBinOk
      ? `Session runtime: ${runtime} (${spec.command})`
      : `Session binary missing: ${spec.command} (runtime=${runtime})`,
    fix: sessionBinOk
      ? undefined
      : `Install ${spec.command} or set AIO_SESSION_RUNTIME / AIO_SESSION_COMMAND`,
  });

  // Embedding
  const embedProvider = process.env.EMBEDDING_PROVIDER || "local";
  if (embedProvider === "openai" && !process.env.OPENAI_API_KEY) {
    checks.push({
      id: "embedding",
      severity: "fail",
      message: "EMBEDDING_PROVIDER=openai but OPENAI_API_KEY missing",
      fix: "Set OPENAI_API_KEY or EMBEDDING_PROVIDER=local",
    });
  } else {
    checks.push({
      id: "embedding",
      severity: "ok",
      message: `Embedding: ${embedProvider}${embedProvider === "local" ? " (first recall may download model)" : ""}`,
    });
  }

  // Optional embed smoke (skip in tests)
  if (!opts?.skipEmbedTest && vaultOk && hasMeta) {
    try {
      const { createEmbedder } = await import("@/knowledge/embedder");
      const emb = createEmbedder();
      await emb.embedOne("doctor smoke test");
      checks.push({ id: "embed_smoke", severity: "ok", message: "Embedder smoke test passed" });
    } catch (err) {
      checks.push({
        id: "embed_smoke",
        severity: "warn",
        message: "Embedder smoke test failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const fails = checks.filter((c) => c.severity === "fail").length;
  const ok = fails === 0;

  if (!next_steps.includes("aio init") && wikiPages < 3) {
    next_steps.push("Add 3+ wiki pages (ingest_source) for domain-aware brainstorm");
  }
  if (hasAioMcp) next_steps.push("Reload MCP in Cursor after config changes");
  next_steps.push('Test: aio aio-prompt "wiki lint" --execute');
  next_steps.push("Chat: brainstorm_design / bootstrap_domain with your task");

  let pkgVersion = "unknown";
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(here, "..", "package.json"),
      path.join(here, "..", "..", "package.json"),
      path.join(process.cwd(), "package.json"),
    ];
    for (const c of candidates) {
      if (!fsSync.existsSync(c)) continue;
      const pkg = JSON.parse(fsSync.readFileSync(c, "utf-8")) as { version?: string; name?: string };
      if (pkg.name === "@mindol1004/aio-mcp" || pkg.version) {
        pkgVersion = pkg.version || pkgVersion;
        if (pkg.name === "@mindol1004/aio-mcp") break;
      }
    }
  } catch {
    /* ignore */
  }

  return {
    ok,
    project_root: projectRoot,
    vault_root: vaultRoot,
    package_version: pkgVersion,
    checks,
    next_steps: [...new Set(next_steps)],
    onboarding_minutes: 5,
  };
}

export const ONBOARDING_CHECKLIST = [
  { step: 1, cmd: "npx -y @mindol1004/aio-mcp init", note: "vault + search index" },
  { step: 2, cmd: "npx -y @mindol1004/aio-mcp bootstrap-harness", note: "AGENTS.md, Cursor rules/hooks, mcp.json" },
  { step: 3, cmd: "Connect MCP in Cursor (.cursor/mcp.json) + reload", note: "AIO_PROJECT_ROOT=${workspaceFolder}" },
  { step: 4, cmd: "npx -y @mindol1004/aio-mcp doctor", note: "verify all checks green/warn-only" },
  { step: 5, cmd: "ingest_source / wiki pages (3+)", note: "domain brainstorm & query quality" },
  { step: 6, cmd: 'aio aio-prompt "wiki lint" --execute', note: "keyword routing smoke test" },
] as const;
