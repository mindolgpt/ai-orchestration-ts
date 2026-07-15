/// <reference types="vitest/globals" />
import { registerWikiTools } from "../src/mcp/tools/wiki-tools";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SemanticSearch } from "../src/knowledge/search";
import type { ObsidianVault } from "../src/knowledge/vault";

function createMockServer() {
  const tools: Array<{ name: string; callback: Function }> = [];
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, callback: Function) => {
      tools.push({ name, callback });
    }),
  };
  return { server: server as unknown as McpServer, tools, getCallback: (name: string) => { const t = tools.find(x => x.name === name); if (!t) throw new Error(`Tool '${name}' not registered`); return t.callback; } };
}

function createMockVault(): ObsidianVault {
  const store = new Map<string, string>();
  store.set("wiki/index.md", "# Wiki Index\n\n## Pages\n\n");
  return {
    initialize: vi.fn(),
    writeNote: vi.fn(async (path: string, content: string) => {
      store.set(`${path}.md`, content);
      return `/vault/${path}.md`;
    }),
    readNote: vi.fn(async (path: string) => store.get(path.endsWith(".md") ? path : `${path}.md`) ?? null),
    listNotes: vi.fn(async () => Array.from(store.keys())),
    getTags: vi.fn(),
    searchByTag: vi.fn(),
  } as unknown as ObsidianVault;
}

function createMockSearch(): SemanticSearch {
  return {
    load: vi.fn(),
    save: vi.fn(),
    search: vi.fn(async (query: string) => {
      if (query === "test-page") {
        return [
          { path: "wiki/related-page", title: "Related Page", score: 0.8, snippet: "related", tags: ["wiki"] },
        ];
      }
      if (query === "hello") {
        return [
          { path: "wiki/hello", title: "Hello", score: 0.9, snippet: "hello world", tags: ["wiki"] },
        ];
      }
      return [];
    }),
    addDocument: vi.fn(),
  } as unknown as SemanticSearch;
}

describe("registerWikiTools", () => {
  test("registers 3 wiki tools", () => {
    const { server, tools } = createMockServer();
    registerWikiTools(server, createMockVault(), createMockSearch());
    expect(tools.map(t => t.name)).toEqual(["ingest_source", "query_wiki", "lint_wiki"]);
  });

  test("ingest_source creates wiki page with metadata", async () => {
    const { server, getCallback } = createMockServer();
    const mockVault = createMockVault();
    const mockSearch = createMockSearch();
    registerWikiTools(server, mockVault, mockSearch);

    const cb = getCallback("ingest_source");
    const result = await cb({ title: "test-page", content: "Test content", tags: ["guide"] });

    expect(mockVault.initialize).toHaveBeenCalled();
    expect(mockSearch.search).toHaveBeenCalledWith("test-page", 5);
    expect(mockVault.writeNote).toHaveBeenCalled();
    expect(mockSearch.addDocument).toHaveBeenCalled();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.wiki_page).toBe("wiki/test-page");
    expect(parsed.title).toBe("test-page");
    expect(parsed.tags).toContain("wiki");
    expect(parsed.is_update).toBe(false);
  });

  test("ingest_source detects existing page (update)", async () => {
    const { server, getCallback } = createMockServer();
    const mockVault = createMockVault();
    const mockSearch = createMockSearch();

    await mockVault.writeNote("wiki/existing", "old content");
    (mockVault.readNote as ReturnType<typeof vi.fn>).mockResolvedValue("old content");

    registerWikiTools(server, mockVault, mockSearch);

    const cb = getCallback("ingest_source");
    const result = await cb({ title: "existing", content: "new content" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.is_update).toBe(true);
  });

  test("query_wiki searches and returns full pages", async () => {
    const { server, getCallback } = createMockServer();
    const mockVault = createMockVault();
    const mockSearch = createMockSearch();

    await mockVault.writeNote("wiki/hello", "hello world content");

    registerWikiTools(server, mockVault, mockSearch);

    const cb = getCallback("query_wiki");
    const result = await cb({ query: "hello", top_k: 5 });

    expect(mockSearch.load).toHaveBeenCalled();
    expect(mockSearch.search).toHaveBeenCalledWith("hello", 5);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.page_count).toBeGreaterThanOrEqual(1);
    expect(parsed.pages[0].full_content).toBe("hello world content");
  });

  test("lint_wiki checks wiki health", async () => {
    const { server, getCallback } = createMockServer();
    const mockVault = createMockVault();
    const mockSearch = createMockSearch();

    await mockVault.writeNote("wiki/index.md", "# Index\n\n## Pages\n- [[hello]]\n");
    (mockVault.listNotes as ReturnType<typeof vi.fn>).mockResolvedValue(["wiki/index.md", "wiki/hello.md"]);

    registerWikiTools(server, mockVault, mockSearch);

    const cb = getCallback("lint_wiki");
    const result = await cb({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_pages).toBe(2);
    expect(parsed.orphan_count).toBeGreaterThanOrEqual(0);
    expect(typeof parsed.index_percent).toBe("number");
  });
});
