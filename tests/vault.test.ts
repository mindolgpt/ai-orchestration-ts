/// <reference types="vitest/globals" />
import { ObsidianVault } from "../src/knowledge/vault";
import { tmpdir } from "os";
import { join } from "path";

describe("ObsidianVault", () => {
  let vault: ObsidianVault;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aio-test-${Date.now()}`);
    vault = new ObsidianVault(testDir);
  });

  test("write and read note", async () => {
    await vault.initialize();
    await vault.writeNote("test/hello", "# Hello", ["test"]);
    const content = await vault.readNote("test/hello");
    expect(content).not.toBeNull();
    expect(content).toContain("# Hello");
    expect(content).toContain("tags: [test]");
  });

  test("list notes", async () => {
    await vault.initialize();
    await vault.writeNote("a/doc1", "one");
    await vault.writeNote("b/doc2", "two");
    const notes = await vault.listNotes();
    expect(notes.length).toBe(3); // index.md + 2 notes
  });

  test("tags", async () => {
    await vault.initialize();
    await vault.writeNote("tagged", "content", ["alpha", "beta"]);
    const tags = await vault.getTags("tagged");
    expect(tags).toEqual(["alpha", "beta"]);
  });

  test("search by tag", async () => {
    await vault.initialize();
    await vault.writeNote("t1", "c1", ["important"]);
    await vault.writeNote("t2", "c2", ["normal"]);
    const results = await vault.searchByTag("important");
    expect(results.length).toBe(1);
  });
});