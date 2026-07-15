import * as fs from "fs/promises";
import * as path from "path";
import { KnowledgeDoc } from "@/knowledge/types";

export class ObsidianVault {
  private root: string;

  constructor(vaultPath: string) {
    this.root = path.resolve(vaultPath);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await this.ensureMoc();
  }

  private async ensureMoc(): Promise<void> {
    const mocPath = path.join(this.root, "index.md");
    try {
      await fs.access(mocPath);
    } catch {
      await fs.writeFile(mocPath, "# Map of Contents\n\n> Auto-generated\n\n## Knowledge Areas\n\n");
    }
  }

  resolvePath(relative: string): string {
    const clean = relative.replace(/\.md$/, "");
    return path.join(this.root, `${clean}.md`);
  }

  async writeNote(
    relativePath: string,
    content: string,
    tags?: string[],
    links?: string[]
  ): Promise<string> {
    const fullPath = this.resolvePath(relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const header: string[] = ["---"];
    if (tags?.length) {
      header.push(`tags: [${tags.join(",")}]`);
    }
    header.push(`created: ${new Date().toISOString()}`);
    header.push("---\n");

    let body = content;
    if (links?.length) {
      body += "\n## Related Notes\n\n" + links.map(l => `- [[${l}]]`).join("\n");
    }

    await fs.writeFile(fullPath, header.join("\n") + "\n" + body, "utf-8");
    await this.updateMoc(path.basename(relativePath, ".md"), relativePath);
    return fullPath;
  }

  async readNote(relativePath: string): Promise<string | null> {
    const fullPath = this.resolvePath(relativePath);
    try {
      return await fs.readFile(fullPath, "utf-8");
    } catch {
      return null;
    }
  }

  async listNotes(prefix = ""): Promise<string[]> {
    const results: string[] = [];
    const scan = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(full);
        } else if (entry.name.endsWith(".md")) {
          const rel = path.relative(this.root, full);
          if (!prefix || rel.startsWith(prefix)) {
            results.push(rel);
          }
        }
      }
    };
    await scan(this.root);
    return results.sort();
  }

  async searchByTag(tag: string): Promise<string[]> {
    const results: string[] = [];
    const files = await this.listNotes();
    for (const file of files) {
      const content = await this.readNote(file);
      if (content && content.includes(`tags: [${tag}`)) {
        results.push(file);
      }
    }
    return results;
  }

  async getTags(relativePath: string): Promise<string[]> {
    const content = await this.readNote(relativePath);
    if (!content) return [];
    const match = content.match(/tags:\s*\[(.+?)\]/);
    return match ? match[1].split(",").map(t => t.trim()) : [];
  }

  private async updateMoc(title: string, link: string): Promise<void> {
    const mocPath = path.join(this.root, "index.md");
    let content: string;
    try {
      content = await fs.readFile(mocPath, "utf-8");
    } catch {
      content = "# Map of Contents\n\n> Auto-generated\n\n## Knowledge Areas\n\n";
    }
    const entry = `- [${title}](${link})`;
    if (!content.includes(entry)) {
      content = content.replace("## Knowledge Areas", `## Knowledge Areas\n${entry}`);
      await fs.writeFile(mocPath, content, "utf-8");
    }
  }

  async toKnowledgeDoc(relativePath: string): Promise<KnowledgeDoc | null> {
    const content = await this.readNote(relativePath);
    if (!content) return null;

    const tags = await this.getTags(relativePath);
    const links = this.extractLinks(content);
    const createdMatch = content.match(/created:\s*(.+)/);
    
    return {
      path: relativePath,
      title: path.basename(relativePath, ".md"),
      content: this.stripFrontmatter(content),
      tags,
      links,
      createdAt: createdMatch?.[1] || new Date().toISOString()
    };
  }

  private extractLinks(content: string): string[] {
    const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
    return Array.from(matches, m => m[1]);
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---[\s\S]*?---\n/, "");
  }
}