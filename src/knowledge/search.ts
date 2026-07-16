import * as fs from "fs/promises";
import * as path from "path";
import { KnowledgeDoc, SearchResult } from "@/knowledge/types";
import {
  FaissIndex,
  FaissIndexFlatIPCtor,
  cosineSimilarity,
  loadFaissIndexFlatIP,
} from "@/knowledge/faiss";

export class SemanticSearch {
  private index: FaissIndex | null = null;
  private IndexFlatIP: FaissIndexFlatIPCtor | null = null;
  private documents: KnowledgeDoc[] = [];
  private indexDir: string;

  constructor(
    private embedder: { embed: (texts: string[]) => Promise<number[][]>; dimension: number },
    indexPath: string = "./vault/.index"
  ) {
    this.indexDir = path.resolve(indexPath);
  }

  private async ensureIndex(): Promise<void> {
    if (this.index) return;
    this.IndexFlatIP = await loadFaissIndexFlatIP();
    await fs.mkdir(this.indexDir, { recursive: true });

    const indexFile = path.join(this.indexDir, "index.faiss");
    const metaFile = path.join(this.indexDir, "meta.json");

    try {
      this.index = this.IndexFlatIP.read(indexFile);
      const meta = JSON.parse(await fs.readFile(metaFile, "utf-8")) as KnowledgeDoc[];
      this.documents = meta;
    } catch {
      this.index = new this.IndexFlatIP(this.embedder.dimension);
      this.documents = [];
    }
  }

  async addDocument(docPath: string, title: string, content: string, tags?: string[]): Promise<void> {
    await this.ensureIndex();
    if (!content.trim()) return;

    const emb = await this.embedder.embed([content]);
    const vec = new Float32Array(emb[0]);

    try {
      this.index!.add(vec);
    } catch (err) {
      console.error("Index add failed:", err);
    }
    this.documents.push({
      path: docPath,
      title,
      tags: tags || [],
      links: [],
      content,
      createdAt: new Date().toISOString(),
    });
  }

  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    await this.ensureIndex();
    if (this.documents.length === 0) return [];

    const qEmb = await this.embedder.embed([query]);
    const qVec = new Float32Array(qEmb[0]);

    try {
      const { distances, indices } = this.index!.search(qVec, Math.min(topK, this.documents.length));
      const results: SearchResult[] = [];
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (idx < 0 || idx >= this.documents.length) continue;
        const doc = this.documents[idx];
        results.push({
          path: doc.path,
          title: doc.title,
          score: distances[i],
          snippet: doc.content.slice(0, 200),
          tags: doc.tags,
        });
      }
      return results;
    } catch {
      const results: SearchResult[] = [];
      for (const doc of this.documents) {
        const docEmb = await this.embedder.embed([doc.content]);
        const score = cosineSimilarity(qVec, new Float32Array(docEmb[0]));
        results.push({
          path: doc.path,
          title: doc.title,
          score,
          snippet: doc.content.slice(0, 200),
          tags: doc.tags,
        });
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, topK);
    }
  }

  async save(): Promise<void> {
    await this.ensureIndex();
    try {
      const indexFile = path.join(this.indexDir, "index.faiss");
      const metaFile = path.join(this.indexDir, "meta.json");
      await this.index!.write(indexFile);
      await fs.writeFile(metaFile, JSON.stringify(this.documents, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save index:", err);
      throw err;
    }
  }

  async load(): Promise<void> {
    await this.ensureIndex();
  }
}
