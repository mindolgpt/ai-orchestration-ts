import * as fs from "fs/promises";
import * as path from "path";
import yaml from "js-yaml";
import { ObsidianVault } from "@/knowledge/vault";
import { resolveProjectRoot } from "@/knowledge/paths";
import { DEFAULT_DOMAIN_PROFILE, DomainProfile } from "@/harness/types";

const PROFILE_NAME = "domain-profile.yaml";

export function profilePath(projectRoot?: string): string {
  return path.join(projectRoot || resolveProjectRoot(), ".aio", PROFILE_NAME);
}

export function vaultProfilePath(vaultRoot: string): string {
  return path.join(vaultRoot, PROFILE_NAME);
}

function mergeProfile(base: DomainProfile, partial: Partial<DomainProfile>): DomainProfile {
  return {
    ...base,
    ...partial,
    stack: { ...base.stack, ...partial.stack },
    wiki: { ...base.wiki, ...partial.wiki },
    loop: { ...base.loop, ...partial.loop },
    harness: { ...base.harness, ...partial.harness },
  };
}

/** Parse wiki/index.md bullet lines for default overview page slugs */
export async function inferOverviewPagesFromWiki(vault: ObsidianVault): Promise<string[]> {
  await vault.initialize();
  const index = await vault.readNote("wiki/index.md");
  if (!index) return [];
  const slugs: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(index)) !== null) {
    const slug = m[1].split("|")[0].trim();
    if (slug && slug !== "index" && slug !== "log") slugs.push(slug);
  }
  return slugs.slice(0, 8);
}

export async function loadDomainProfile(
  vault: ObsidianVault,
  projectRoot?: string
): Promise<{ profile: DomainProfile; path: string; source: "project" | "vault" | "default" }> {
  const root = projectRoot || resolveProjectRoot();
  const candidates = [profilePath(root), vaultProfilePath(vault.rootPath)];

  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const parsed = yaml.load(raw) as Partial<DomainProfile>;
      if (parsed && typeof parsed === "object") {
        return {
          profile: mergeProfile(DEFAULT_DOMAIN_PROFILE, parsed),
          path: p,
          source: p.includes(vault.rootPath) ? "vault" : "project",
        };
      }
    } catch {
      /* try next */
    }
  }

  const overview = await inferOverviewPagesFromWiki(vault);
  const profile = mergeProfile(DEFAULT_DOMAIN_PROFILE, {
    name: overview.length ? "wiki-inferred" : "default",
    domain: overview.length ? "wiki" : "general",
    description: "Auto-inferred from vault wiki index",
    wiki: { overview_pages: overview.slice(0, 5) },
  });

  return { profile, path: profilePath(root), source: "default" };
}

export async function saveDomainProfile(
  profile: DomainProfile,
  projectRoot?: string
): Promise<string> {
  const p = profilePath(projectRoot);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, yaml.dump(profile, { lineWidth: 100 }), "utf-8");
  return p;
}
