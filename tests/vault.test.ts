/// <reference types="vitest/globals" />
import { ObsidianVault } from "../src/knowledge/vault";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync } from "fs";

describe("ObsidianVault", () => {
  let vault: ObsidianVault;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "aio-vault-"));
    vault = new ObsidianVault(testDir);
  });

  test("initialize seeds 3 layers", async () => {
    await vault.initialize();
    expect(await vault.readSchema()).toContain("Wiki Schema");
    expect(await vault.readNote("wiki/index")).toContain("## Pages");
    expect(await vault.readNote("wiki/log")).toContain("Change Log");
    const notes = await vault.listNotes("raw/");
    expect(Array.isArray(notes)).toBe(true);
  });

  test("write and read note", async () => {
    await vault.initialize();
    await vault.writeNote("wiki/hello", "# Hello", ["test"]);
    const content = await vault.readNote("wiki/hello");
    expect(content).not.toBeNull();
    expect(content).toContain("# Hello");
    expect(content).toContain("tags: [test]");
  });

  test("refuses writing to raw via writeNote", async () => {
    await vault.initialize();
    await expect(vault.writeNote("raw/secret", "x")).rejects.toThrow(/immutable/);
  });

  test("writeRawOnce is immutable create-once", async () => {
    await vault.initialize();
    const first = await vault.writeRawOnce({ title: "Doc A", content: "original text" });
    expect(first.path).toMatch(/^raw\//);
    const raw = await vault.readNote(first.path.replace(/\.md$/, ""));
    expect(raw).toContain("original text");
    expect(raw).toContain("immutable: true");

    await expect(
      vault.writeRawOnce({ title: "Doc A", content: "hack", id: first.id })
    ).rejects.toThrow(/already exists/);
  });

  test("upsertWikiIndexEntry does not duplicate frontmatter", async () => {
    await vault.initialize();
    await vault.upsertWikiIndexEntry({
      slug: "cart",
      title: "Cart",
      summary: "shopping cart domain",
      tags: ["ecommerce"],
    });
    await vault.upsertWikiIndexEntry({
      slug: "cart",
      title: "Cart",
      summary: "updated summary",
      tags: ["ecommerce"],
    });
    const index = await vault.readNote("wiki/index");
    const fmMarkers = index!.match(/^---$/gm) || [];
    expect(fmMarkers.length).toBe(2);
    expect(index).toContain("updated summary");
    expect((index!.match(/\[\[cart\]\]/g) || []).length).toBe(1);
  });

  test("appendLog is append-only", async () => {
    await vault.initialize();
    await vault.appendLog("## [2026-01-01] ingest | A");
    await vault.appendLog("## [2026-01-02] ingest | B");
    await vault.appendLog("## [2026-01-01] ingest | A"); // duplicate ignored
    const log = await vault.readNote("wiki/log");
    expect(log).toContain("ingest | A");
    expect(log).toContain("ingest | B");
    expect((log!.match(/ingest \| A/g) || []).length).toBe(1);
  });

  test("tags", async () => {
    await vault.initialize();
    await vault.writeNote("wiki/tagged", "content", ["alpha", "beta"]);
    const tags = await vault.getTags("wiki/tagged");
    expect(tags).toEqual(["alpha", "beta"]);
  });
});
