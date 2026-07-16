/// <reference types="vitest/globals" />
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runDoctor, ONBOARDING_CHECKLIST } from "../src/doctor/check";
import { ObsidianVault } from "../src/knowledge/vault";

describe("runDoctor", () => {
  test("reports fail when vault missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aio-doc-fail-"));
    const report = await runDoctor({
      projectRoot: root,
      skipEmbedTest: true,
    });
    expect(report.checks.some((c) => c.id === "vault" && c.severity === "fail")).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.next_steps).toContain("aio init");
  });

  test("reports ok with init + harness", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aio-doc-ok-"));
    const vaultPath = path.join(root, "vault");
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();
    await vault.writeNote("wiki/a", "# A", ["wiki"]);
    await vault.writeNote("wiki/b", "# B", ["wiki"]);
    await vault.writeNote("wiki/c", "# C", ["wiki"]);

    await fs.mkdir(path.join(root, ".aio"), { recursive: true });
    await fs.writeFile(path.join(root, "AGENTS.md"), "# agents", "utf-8");
    await fs.writeFile(path.join(root, ".aio", "domain-profile.yaml"), "domain: x", "utf-8");
    await fs.mkdir(path.join(vaultPath, ".index"), { recursive: true });
    await fs.writeFile(path.join(vaultPath, ".index", "meta.json"), "{}", "utf-8");
    await fs.writeFile(path.join(vaultPath, ".index", "index.faiss"), "", "utf-8");

    const report = await runDoctor({
      projectRoot: root,
      skipEmbedTest: true,
    });
    expect(report.checks.find((c) => c.id === "vault")?.severity).toBe("ok");
    expect(report.checks.find((c) => c.id === "wiki_pages")?.severity).toBe("ok");
    expect(report.project_root).toBe(root);
  });

  test("flags foreign harness files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aio-doc-for-"));
    const vaultPath = path.join(root, "vault");
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();
    await fs.writeFile(path.join(root, "AGENTS.md"), "# a", "utf-8");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "# c", "utf-8");
    await fs.mkdir(path.join(root, ".cursor", "rules"), { recursive: true });
    await fs.writeFile(path.join(root, ".cursor", "rules", "aio-domain-harness.mdc"), "r", "utf-8");
    await fs.mkdir(path.join(vaultPath, ".index"), { recursive: true });
    await fs.writeFile(path.join(vaultPath, ".index", "meta.json"), "{}", "utf-8");
    await fs.writeFile(path.join(vaultPath, ".index", "index.faiss"), "", "utf-8");

    const report = await runDoctor({
      projectRoot: root,
      vault: vaultPath,
      skipEmbedTest: true,
    });
    expect(report.foreign_harness_files.some((f) => f.rel === "CLAUDE.md")).toBe(true);
    expect(report.checks.some((c) => c.id.startsWith("foreign_"))).toBe(true);
  });
});

describe("ONBOARDING_CHECKLIST", () => {
  test("has 6 steps", () => {
    expect(ONBOARDING_CHECKLIST.length).toBe(6);
  });
});
