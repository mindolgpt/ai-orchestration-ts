import { ObsidianVault } from "@/knowledge/vault";
import { SemanticSearch } from "@/knowledge/search";
import { slugifyTitle, WIKI_SCHEMA_PATH } from "@/knowledge/wiki-schema";
import { toPosixPath } from "@/knowledge/paths";

export interface IngestSourceInput {
  title: string;
  content: string;
  tags?: string[];
  raw_id?: string;
  source_path?: string;
  summary?: string;
}

export interface FileBackInput {
  title: string;
  content: string;
  tags?: string[];
  citations?: string[];
  query?: string;
}

export interface LintResult {
  ok: boolean;
  schema_present: boolean;
  total_wiki_pages: number;
  orphans: string[];
  orphan_count: number;
  missing_from_index: string[];
  index_coverage: string;
  index_percent: number;
  raw_count: number;
  issues: string[];
  pages: Array<{ path: string; inbound_links: number; is_orphan: boolean }>;
  deep?: {
    broken_links: Array<{ page: string; target: string }>;
    stubs: string[];
    stale_pages: string[];
    deprecated_still_linked: string[];
  };
}

function oneLineSummary(text: string, fallback: string): string {
  const cleaned = text.replace(/[#>*`\[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 160);
}

export async function getWikiSchema(vault: ObsidianVault): Promise<{ path: string; content: string }> {
  await vault.initialize();
  return { path: WIKI_SCHEMA_PATH, content: await vault.readSchema() };
}

export async function ingestRaw(
  vault: ObsidianVault,
  opts: { title: string; content: string; source_uri?: string; id?: string }
) {
  await vault.initialize();
  const result = await vault.writeRawOnce(opts);
  await vault.appendLog(
    `## [${new Date().toISOString().slice(0, 10)}] ingest_raw | ${opts.title} (${result.path})`
  );
  return result;
}

export async function ingestSource(
  vault: ObsidianVault,
  search: SemanticSearch,
  args: IngestSourceInput
) {
  await vault.initialize();
  const slug = slugifyTitle(args.title);
  const wikiPath = `wiki/${slug}`;
  const existingContent = await vault.readNote(wikiPath);

  await search.load();
  const related = await search.search(args.title, 5);
  const relatedLinks = related
    .filter((r) => toPosixPath(r.path).replace(/\.md$/, "") !== wikiPath)
    .slice(0, 5)
    .map((r) => r.title);

  const allTags = [
    ...new Set([
      ...(args.tags || []),
      "wiki",
      ...(args.raw_id || args.source_path ? ["source"] : []),
    ]),
  ];

  const sourceRef = args.raw_id
    ? `raw_id=${args.raw_id}`
    : args.source_path || "direct input";

  const noteContent = [
    `> **Source:** ${sourceRef}`,
    `> **Ingested:** ${new Date().toISOString().slice(0, 10)}`,
    "",
    existingContent ? "> **Updated** — previous wiki version replaced\n" : "",
    args.content.trim(),
    "",
    relatedLinks.length
      ? "## Related Pages\n\n" + relatedLinks.map((l) => `- [[${l}]]`).join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  await vault.writeNote(wikiPath, noteContent, allTags, relatedLinks);
  await search.addDocument(wikiPath, args.title, args.content, allTags);
  await search.save();

  const summary = args.summary || oneLineSummary(args.content, args.title);
  await vault.upsertWikiIndexEntry({
    slug,
    title: args.title,
    summary,
    tags: allTags,
  });
  await vault.appendLog(
    `## [${new Date().toISOString().slice(0, 10)}] ingest | ${args.title}` +
      (args.raw_id ? ` (raw:${args.raw_id})` : args.source_path ? ` (${args.source_path})` : "")
  );

  return {
    wiki_page: wikiPath,
    title: args.title,
    tags: allTags,
    related_pages: relatedLinks,
    is_update: !!existingContent,
    raw_id: args.raw_id || null,
    source: sourceRef,
    next_steps: [
      "Update related entity/concept pages with update_wiki_page if claims changed",
      "Re-read wiki/index.md and wiki/log.md to confirm catalog + timeline",
    ],
  };
}

export async function updateWikiPage(
  vault: ObsidianVault,
  search: SemanticSearch,
  opts: { title: string; content: string; tags?: string[]; summary?: string }
) {
  await vault.initialize();
  const slug = slugifyTitle(opts.title);
  const wikiPath = `wiki/${slug}`;
  const existing = await vault.readNote(wikiPath);
  if (!existing) {
    throw new Error(`wiki page not found: ${wikiPath} — use ingest_source to create`);
  }

  const tags = [...new Set([...(opts.tags || []), "wiki"])];
  await vault.writeNote(wikiPath, opts.content, tags);
  await search.addDocument(wikiPath, opts.title, opts.content, tags);
  await search.save();
  await vault.upsertWikiIndexEntry({
    slug,
    title: opts.title,
    summary: opts.summary || oneLineSummary(opts.content, opts.title),
    tags,
  });
  await vault.appendLog(
    `## [${new Date().toISOString().slice(0, 10)}] update | ${opts.title}`
  );

  return { wiki_page: wikiPath, title: opts.title, tags };
}

export async function queryWiki(
  vault: ObsidianVault,
  search: SemanticSearch,
  query: string,
  topK = 5
) {
  await vault.initialize();
  await search.load();
  const results = await search.search(query, topK);

  const pages = await Promise.all(
    results.map(async (r) => {
      const fullContent = await vault.readNote(r.path);
      return {
        path: r.path,
        title: r.title,
        score: r.score,
        snippet: r.snippet,
        tags: r.tags,
        full_content: fullContent || r.snippet,
      };
    })
  );

  const citations = pages.map((p) => ({
    path: p.path,
    title: p.title,
    score: p.score,
  }));

  return {
    query,
    page_count: pages.length,
    citations,
    pages,
    reminder:
      "Synthesize an answer with citations. If durable, call file_back to write it into the wiki.",
  };
}

export async function fileBack(
  vault: ObsidianVault,
  search: SemanticSearch,
  args: FileBackInput
) {
  await vault.initialize();
  const slug = slugifyTitle(args.title);
  const wikiPath = `wiki/${slug}`;
  const tags = [...new Set([...(args.tags || []), "wiki", "file-back"])];

  const citationBlock =
    args.citations?.length
      ? "## Citations\n\n" + args.citations.map((c) => `- [[${c}]]`).join("\n")
      : "";

  const body = [
    args.query ? `> **Filed back from query:** ${args.query}` : "",
    "",
    args.content.trim(),
    "",
    citationBlock,
  ]
    .filter(Boolean)
    .join("\n");

  await vault.writeNote(wikiPath, body, tags);
  await search.addDocument(wikiPath, args.title, args.content, tags);
  await search.save();
  await vault.upsertWikiIndexEntry({
    slug,
    title: args.title,
    summary: oneLineSummary(args.content, args.title),
    tags,
  });
  await vault.appendLog(
    `## [${new Date().toISOString().slice(0, 10)}] file_back | ${args.title}` +
      (args.query ? ` (q: ${args.query.slice(0, 80)})` : "")
  );

  return { wiki_page: wikiPath, title: args.title, tags };
}

export async function lintWiki(
  vault: ObsidianVault,
  opts?: { deep?: boolean; staleDays?: number }
): Promise<LintResult> {
  await vault.initialize();
  const issues: string[] = [];
  const schema_present = await vault.schemaExists();
  if (!schema_present) {
    issues.push("Missing vault schema AGENTS.md");
  }

  const allWiki = (await vault.listNotes("wiki/")).filter(
    (p) => !p.endsWith("/index.md") && !p.endsWith("/log.md") && p !== "wiki/index.md" && p !== "wiki/log.md"
  );
  const rawPages = await vault.listNotes("raw/");
  const pageSet = new Set(await vault.listNotes("wiki/"));

  const allContents = new Map<string, string>();
  for (const p of await vault.listNotes("wiki/")) {
    const content = await vault.readNote(p);
    if (content) allContents.set(p, content);
  }

  const linkedTo = new Map<string, string[]>();
  for (const p of pageSet) linkedTo.set(p, []);

  for (const [p, content] of allContents) {
    const linkMatches = content.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const m of linkMatches) {
      const target = slugifyTitle(m[1]);
      const targetPath = `wiki/${target}.md`;
      if (pageSet.has(targetPath)) {
        const existing = linkedTo.get(targetPath) || [];
        existing.push(p);
        linkedTo.set(targetPath, existing);
      }
    }
  }

  const orphans: string[] = [];
  for (const p of allWiki) {
    const inbound = linkedTo.get(p) || [];
    if (inbound.length === 0) orphans.push(p);
  }

  const indexContent = await vault.readNote("wiki/index.md");
  const missing_from_index: string[] = [];
  let indexCoverage = 0;
  for (const p of allWiki) {
    const title = p.replace(/^wiki\//, "").replace(/\.md$/, "");
    if (indexContent?.includes(`[[${title}]]`)) {
      indexCoverage++;
    } else {
      missing_from_index.push(p);
    }
  }

  if (orphans.length) {
    issues.push(`${orphans.length} orphan wiki page(s) with no inbound links`);
  }
  if (missing_from_index.length) {
    issues.push(`${missing_from_index.length} page(s) missing from wiki/index.md`);
  }
  if (rawPages.length === 0 && allWiki.length > 0) {
    issues.push("Wiki pages exist but raw/ has no sources — durable knowledge should keep immutable raw");
  }

  // Detect broken index/log (multiple frontmatter — legacy corruption)
  for (const special of ["wiki/index.md", "wiki/log.md"]) {
    const c = await vault.readNote(special);
    if (c) {
      const fmCount = (c.match(/^---$/gm) || []).length;
      if (fmCount > 2) {
        issues.push(`${special} has duplicated frontmatter — run init/repair or rewrite file`);
      }
    }
  }

  const denom = allWiki.length || 1;
  const index_percent = allWiki.length
    ? Math.round((indexCoverage / denom) * 100)
    : 100;

  let deep: LintResult["deep"] | undefined;
  if (opts?.deep) {
    const broken_links: Array<{ page: string; target: string }> = [];
    const stubs: string[] = [];
    const stale_pages: string[] = [];
    const deprecated_still_linked: string[] = [];
    const staleDays = opts.staleDays ?? 90;
    const staleMs = staleDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const [p, content] of allContents) {
      if (p.endsWith("/index.md") || p.endsWith("/log.md") || p === "wiki/index.md" || p === "wiki/log.md") {
        continue;
      }
      const linkMatches = content.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const m of linkMatches) {
        const target = slugifyTitle(m[1].split("|")[0].trim());
        const targetPath = `wiki/${target}.md`;
        if (!pageSet.has(targetPath) && !pageSet.has(`wiki/${target}`)) {
          // allow links to index/log specials by title
          if (target !== "index" && target !== "log") {
            broken_links.push({ page: p, target: m[1] });
          }
        }
      }

      const body = content.replace(/^---[\s\S]*?---\s*/, "").trim();
      if (body.length < 80 && (linkedTo.get(p) || []).length === 0) {
        stubs.push(p);
      }

      const updated = content.match(/updated:\s*['"]?(\d{4}-\d{2}-\d{2})/);
      const created = content.match(/created:\s*['"]?(\d{4}-\d{2}-\d{2})/);
      const dateStr = updated?.[1] || created?.[1];
      if (dateStr) {
        const t = Date.parse(dateStr);
        if (!Number.isNaN(t) && now - t > staleMs) {
          stale_pages.push(p);
        }
      }

      if (/\b(DEPRECATED|superseded|obsolete)\b/i.test(content)) {
        const inbound = linkedTo.get(p) || [];
        if (inbound.length >= 2) {
          deprecated_still_linked.push(p);
        }
      }
    }

    if (broken_links.length) {
      issues.push(`${broken_links.length} broken wiki link(s)`);
    }
    if (stubs.length) {
      issues.push(`${stubs.length} stub page(s) (short + no inbound)`);
    }
    if (stale_pages.length) {
      issues.push(`${stale_pages.length} stale page(s) older than ${staleDays}d`);
    }
    if (deprecated_still_linked.length) {
      issues.push(`${deprecated_still_linked.length} deprecated page(s) still heavily linked`);
    }

    deep = { broken_links, stubs, stale_pages, deprecated_still_linked };
  }

  const ok = issues.length === 0;

  return {
    ok,
    schema_present,
    total_wiki_pages: allWiki.length,
    orphans,
    orphan_count: orphans.length,
    missing_from_index,
    index_coverage: `${indexCoverage}/${allWiki.length}`,
    index_percent,
    raw_count: rawPages.length,
    issues,
    pages: allWiki.map((p) => ({
      path: p,
      inbound_links: (linkedTo.get(p) || []).length,
      is_orphan: orphans.includes(p),
    })),
    deep,
  };
}
