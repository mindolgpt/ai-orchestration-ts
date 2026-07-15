import * as fs from "fs/promises";
import * as path from "path";
import { KnowledgeDoc, SearchResult } from "@/knowledge/types";

interface FaissSearchResult {
  distances: Float32Array;
  indices: Int32Array;
}

interface FaissIndex {
  add(vector: Float32Array | number[]): void;
  search(query: Float32Array, k: number): FaissSearchResult;
  write(filename: string): void | Promise<void>;
}

let FaissConstructor: new (...args: unknown[]) => FaissIndex;

async function loadFaiss(): Promise<void> {
  if (FaissConstructor) return;
  try {
    const faiss = await import("faiss-node");
    FaissConstructor = faiss.IndexFlatIP as unknown as new (...args: unknown[]) => FaissIndex;
  } catch {
    FaissConstructor = class MockIndex {
      vectors: Float32Array[] = [];
      add(v: Float32Array | number[]) { this.vectors.push(Float32Array.from(v)); }
      search(q: Float32Array | number[], k: number) {
        const qVec = Float32Array.from(q);
        const distances = this.vectors.map(v => cosineSimilarity(qVec, v));
        const indices = distances.map((_, i) => i).sort((a, b) => distances[b] - distances[a]).slice(0, k);
        return { distances: new Float32Array(indices.map(i => distances[i])), indices: new Int32Array(indices) };
      }
      write() {}
      static read() { return new MockIndex(); }
    };
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}


export class SemanticSearch {
  private index: FaissIndex | null = null;
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
    await loadFaiss();
    await fs.mkdir(this.indexDir, { recursive: true });

    const indexFile = path.join(this.indexDir, "index.faiss");
    const metaFile = path.join(this.indexDir, "meta.json");

    try {
      const { IndexFlatIP } = await import("faiss-node");
      this.index = IndexFlatIP.read(indexFile) as unknown as FaissIndex;
      const meta = JSON.parse(await fs.readFile(metaFile, "utf-8")) as KnowledgeDoc[];
      this.documents = meta;
    } catch {
      this.index = new (FaissConstructor!)(this.embedder.dimension);
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
    this.documents.push({ path: docPath, title, tags: tags || [], links: [], content, createdAt: new Date().toISOString() });
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
          tags: doc.tags
        });
      }
      return results;
    } catch {
      const results: SearchResult[] = [];
      for (const doc of this.documents) {
        const docEmb = await this.embedder.embed([doc.content]);
        const score = cosineSimilarity(qVec, new Float32Array(docEmb[0]));
        results.push({ path: doc.path, title: doc.title, score, snippet: doc.content.slice(0, 200), tags: doc.tags });
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, topK);
    }
  }

  async save(): Promise<void> {
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
