/// <reference types="vitest/globals" />
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ObsidianVault } from "../src/knowledge/vault";
import { seedStackPlaybooks, seedPatternPlaybooks } from "../src/harness/seed-stacks";
import { ALL_STACK_IDS } from "../src/harness/stack-playbooks";
import type { SemanticSearch } from "../src/knowledge/search";

function mockSearch() {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    addDocument: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SemanticSearch;
}

describe("seedStackPlaybooks", () => {
  test("seeds all stack playbooks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aio-seed-"));
    const vaultPath = path.join(root, "vault");
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();

    const result = await seedStackPlaybooks(vault, mockSearch());
    expect(result.seeded).toBe(ALL_STACK_IDS.length);
    expect(result.pages.length).toBe(ALL_STACK_IDS.length);

    const reactPath = path.join(vaultPath, "wiki", "stacks", "react.md");
    const content = await fs.readFile(reactPath, "utf-8");
    expect(content).toContain("Stack playbook");
  });

  test("skips existing long pages on re-seed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aio-seed2-"));
    const vaultPath = path.join(root, "vault");
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();
    const search = mockSearch();

    await seedStackPlaybooks(vault, search, ["react"]);
    const second = await seedStackPlaybooks(vault, search, ["react"]);
    expect(second.skipped).toBe(1);
    expect(second.seeded).toBe(0);
  });

  test("seedPatternPlaybooks writes patterns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aio-pat-"));
    const vaultPath = path.join(root, "vault");
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();

    const result = await seedPatternPlaybooks(vault, mockSearch());
    expect(result.seeded).toContain("patterns/clean-architecture");
    const p = path.join(vaultPath, "wiki", "patterns", "clean-architecture.md");
    expect(await fs.stat(p)).toBeDefined();
  });
});
