import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ObsidianVault } from "@/knowledge/vault";
import { SemanticSearch } from "@/knowledge/search";

export function registerWikiTools(
  server: McpServer,
  vault: ObsidianVault,
  search: SemanticSearch
): void {
  server.registerTool("ingest_source", {
    description: "Create/update a wiki page (one concept per call)",
    inputSchema: z.object({ title: z.string(), content: z.string(), tags: z.array(z.string()).optional(), source_path: z.string().optional() }),
  }, async (args) => {
    await vault.initialize();
    const safeName = args.title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "") || "untitled";
    const wikiPath = `wiki/${safeName}`;
    const existingContent = await vault.readNote(wikiPath);
    await search.load();

    const related = await search.search(args.title, 5);
    const relatedLinks = related
      .filter(r => r.path !== wikiPath)
      .slice(0, 3)
      .map(r => r.title);

    const allTags = [...new Set([...(args.tags || []), "wiki", ...(args.source_path ? ["source"] : [])])];

    const noteContent = [
      `> **Source:** ${args.source_path || "direct input"}`,
      `> **Ingested:** ${new Date().toISOString().slice(0, 10)}`,
      "",
      existingContent ? "> **Updated** — previous version replaced\n" : "",
      args.content,
      "",
      relatedLinks.length ? "## Related Pages\n\n" + relatedLinks.map(l => `- [[${l}]]`).join("\n") : ""
    ].filter(Boolean).join("\n");

    await vault.writeNote(wikiPath, noteContent, allTags, relatedLinks);
    await search.addDocument(wikiPath, args.title, args.content, allTags);
    await search.save();

    await updateIndex(vault, safeName, args.title, allTags);
    await updateLog(vault, "ingest", args.title, args.source_path);

    return { content: [{ type: "text" as const, text: JSON.stringify({
      wiki_page: wikiPath,
      title: args.title,
      tags: allTags,
      related_pages: relatedLinks,
      is_update: !!existingContent,
      source: args.source_path || null
    }) }] };
  });

  server.registerTool("query_wiki", {
    description: "Search wiki pages with full content",
    inputSchema: z.object({ query: z.string(), top_k: z.number().optional() }),
  }, async (args) => {
    await search.load();
    const results = await search.search(args.query, args.top_k ?? 5);

    const fullPages = await Promise.all(
      results.map(async (r) => {
        const fullContent = await vault.readNote(r.path);
        return { path: r.path, title: r.title, score: r.score, snippet: r.snippet, tags: r.tags, full_content: fullContent || r.snippet };
      })
    );

    return { content: [{ type: "text" as const, text: JSON.stringify({ query: args.query, page_count: fullPages.length, pages: fullPages }) }] };
  });

  server.registerTool("lint_wiki", {
    description: "Check wiki health: orphans, coverage",
  }, async () => {
    await vault.initialize();
    const allPages = await vault.listNotes("wiki/");
    const pageSet = new Set(allPages);

    const allContents = new Map<string, string>();
    for (const p of allPages) {
      const content = await vault.readNote(p);
      if (content) allContents.set(p, content);
    }

    const orphans: string[] = [];
    const linkedTo: Map<string, string[]> = new Map();
    for (const p of allPages) linkedTo.set(p, []);

    for (const [p, content] of allContents) {
      const linkMatches = content.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const m of linkMatches) {
        const target = m[1];
        const targetPath = `wiki/${target.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "")}.md`;
        if (pageSet.has(targetPath)) {
          const existing = linkedTo.get(targetPath) || [];
          existing.push(p);
          linkedTo.set(targetPath, existing);
        }
      }
    }

    for (const p of allPages) {
      const inbound = linkedTo.get(p) || [];
      if (inbound.length === 0 && !p.endsWith("/index.md")) {
        orphans.push(p);
      }
    }

    const indexContent = await vault.readNote("wiki/index.md");
    let indexCoverage = 0;
    for (const p of allPages) {
      if (p === "wiki/index.md") continue;
      const title = p.replace("wiki/", "").replace(/\.md$/, "");
      if (indexContent?.includes(`[[${title}]]`)) indexCoverage++;
    }

    return { content: [{ type: "text" as const, text: JSON.stringify({
      total_pages: allPages.length,
      orphans,
      orphan_count: orphans.length,
      index_coverage: `${indexCoverage}/${allPages.length - 1}`,
      index_percent: allPages.length > 1 ? Math.round((indexCoverage / (allPages.length - 1)) * 100) : 100,
      pages: allPages.map(p => ({ path: p, inbound_links: (linkedTo.get(p) || []).length, is_orphan: orphans.includes(p) }))
    }) }] };
  });
}

async function updateIndex(vault: ObsidianVault, safeName: string, title: string, tags: string[]): Promise<void> {
  const indexContent = (await vault.readNote("wiki/index.md")) || "# Wiki Index\n\n## Pages\n\n";
  const entry = `- [[${safeName}]] — ${title}${tags.length ? ` (${tags.join(", ")})` : ""}`;
  if (!indexContent.includes(`[[${safeName}]]`)) {
    const updated = indexContent.replace("## Pages", `## Pages\n${entry}`);
    await vault.writeNote("wiki/index.md", updated, ["wiki-index"]);
  }
}

async function updateLog(vault: ObsidianVault, action: string, title: string, sourcePath?: string): Promise<void> {
  const logContent = (await vault.readNote("wiki/log.md")) || "# Change Log\n\n";
  const date = new Date().toISOString().slice(0, 10);
  const entry = `## [${date}] ${action} | ${title}${sourcePath ? ` (${sourcePath})` : ""}`;
  if (!logContent.includes(entry)) {
    const updated = logContent + "\n" + entry;
    await vault.writeNote("wiki/log.md", updated, ["wiki-log"]);
  }
}
