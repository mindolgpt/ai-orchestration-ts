/// <reference types="vitest/globals" />
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ObsidianVault } from "../src/knowledge/vault";
import { designArchitecture } from "../src/harness/architecture";
import { saveDomainProfile } from "../src/harness/profile";
import type { SemanticSearch } from "../src/knowledge/search";

function mockSearch(results: Array<{ path: string; title: string; snippet: string; score: number }> = []) {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(results),
    addDocument: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SemanticSearch;
}

describe("designArchitecture", () => {
  test("returns questions when answers missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aio-arch-q-"));
    const vaultPath = path.join(root, "vault");
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();

    const result = await designArchitecture(vault, mockSearch(), "쇼핑몰 아키텍처", {
      project_root: root,
    });
    expect(result.status).toBe("questions");
    expect(result.pending_questions.length).toBeGreaterThan(0);
  });

  test("writes docs when answers provided", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aio-arch-d-"));
    const vaultPath = path.join(root, "vault");
    const vault = new ObsidianVault(vaultPath);
    await vault.initialize();
    await vault.writeNote("wiki/장바구니-cart", "# Cart\n\nRedis cart BC.", ["wiki", "cart"]);

    await saveDomainProfile(
      {
        name: "shop",
        domain: "ecommerce",
        description: "shop",
        stack: { backend: "spring-boot", frontend: "react" },
        wiki: { overview_pages: ["장바구니-cart"] },
      },
      root
    );

    const search = mockSearch();
    const result = await designArchitecture(vault, search, "쇼핑몰 Spring React", {
      project_root: root,
      skip_questions: true,
      answers: {
        team_size: "FE 2 BE 3",
        deployment: "modular-monolith",
        scale: "mvp",
        auth_model: "JWT",
      },
    });

    expect(result.status).toBe("draft");
    expect(result.modules.length).toBeGreaterThan(0);
    expect(result.detected_stacks.backend).toBe("spring-boot");

    const archMd = path.join(root, "docs", "architecture.md");
    const archJson = path.join(root, ".aio", "architecture.json");
    expect(await fs.stat(archMd)).toBeDefined();
    expect(await fs.stat(archJson)).toBeDefined();
  });
});
