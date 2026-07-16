import * as fs from "fs/promises";
import * as path from "path";
import { ObsidianVault } from "@/knowledge/vault";
import { SemanticSearch } from "@/knowledge/search";
import { slugifyTitle } from "@/knowledge/wiki-schema";
import { STACK_PLAYBOOKS, StackPlaybook } from "@/harness/stack-playbooks";

export interface SeedStacksResult {
  seeded: number;
  skipped: number;
  pages: Array<{ id: string; wiki_path: string; title: string }>;
}

export async function seedStackPlaybooks(
  vault: ObsidianVault,
  search: SemanticSearch,
  stackIds?: string[]
): Promise<SeedStacksResult> {
  await vault.initialize();
  await search.load();

  const targets: StackPlaybook[] = stackIds?.length
    ? STACK_PLAYBOOKS.filter((p) => stackIds.includes(p.id))
    : STACK_PLAYBOOKS;

  const pages: SeedStacksResult["pages"] = [];
  let seeded = 0;
  let skipped = 0;

  for (const pb of targets) {
    const wikiPath = `wiki/stacks/${pb.id}`;
    const existing = await vault.readNote(wikiPath);
    if (existing && existing.length > 200) {
      skipped++;
      pages.push({ id: pb.id, wiki_path: `${wikiPath}.md`, title: pb.title });
      continue;
    }

    await vault.writeNote(wikiPath, pb.content, pb.tags);
    await search.addDocument(wikiPath, pb.title, pb.content, pb.tags);
    await vault.upsertWikiIndexEntry({
      slug: `stacks/${pb.id}`,
      title: pb.title,
      summary: `${pb.category} stack playbook — ${pb.id}`,
      tags: pb.tags,
    });
    seeded++;
    pages.push({ id: pb.id, wiki_path: `${wikiPath}.md`, title: pb.title });
  }

  await search.save();
  await vault.appendLog(
    `## [${new Date().toISOString().slice(0, 10)}] seed_stacks | ${seeded} playbooks (${targets.length} requested)`
  );

  return { seeded, skipped, pages };
}

export async function seedPatternPlaybooks(
  vault: ObsidianVault,
  search: SemanticSearch
): Promise<{ seeded: string[] }> {
  const patterns = [
    {
      slug: "patterns/clean-architecture",
      title: "Clean Architecture",
      content: `## Layers\n\nEntities → Use Cases → Interface Adapters → Frameworks\n\n## With domain wiki\n\nEach bounded context gets its own use-case layer; do not share entities across contexts.`,
      tags: ["pattern", "architecture"],
    },
    {
      slug: "patterns/hexagonal",
      title: "Hexagonal (Ports & Adapters)",
      content: `## Ports\n\nInbound: API, CLI\nOutbound: DB, messaging, external APIs\n\n## Rule\n\nDomain core has zero framework imports.`,
      tags: ["pattern", "architecture"],
    },
    {
      slug: "patterns/modular-monolith",
      title: "Modular Monolith",
      content: `## When\n\nSingle deploy, multiple teams, clear BC boundaries\n\n## Structure\n\nOne repo, modules communicate via events or explicit APIs only.`,
      tags: ["pattern", "architecture"],
    },
  ];

  await vault.initialize();
  await search.load();
  const seeded: string[] = [];

  for (const p of patterns) {
    const wikiPath = `wiki/${p.slug}`;
    await vault.writeNote(wikiPath, p.content, p.tags);
    await search.addDocument(wikiPath, p.title, p.content, p.tags);
    await vault.upsertWikiIndexEntry({
      slug: p.slug,
      title: p.title,
      summary: p.title,
      tags: p.tags,
    });
    seeded.push(p.slug);
  }
  await search.save();
  return { seeded };
}
