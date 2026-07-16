export interface FaissSearchResult {
  distances: Float32Array;
  indices: Int32Array;
}

export interface FaissIndex {
  add(vector: Float32Array | number[]): void;
  search(query: Float32Array, k: number): FaissSearchResult;
  write(filename: string): void | Promise<void>;
}

export type FaissIndexFlatIPCtor = (new (dimension: number) => FaissIndex) & {
  read(filename: string): FaissIndex;
};

/**
 * faiss-node is a CJS module. Under Node ESM `import()`, constructors live on
 * `mod.default` (or `mod["module.exports"]`), not on the namespace root.
 * Reading `mod.IndexFlatIP` yields undefined → "X is not a constructor".
 */
export function resolveIndexFlatIP(mod: Record<string, unknown>): FaissIndexFlatIPCtor | null {
  const candidates: unknown[] = [
    mod.IndexFlatIP,
    (mod.default as Record<string, unknown> | undefined)?.IndexFlatIP,
    (mod["module.exports"] as Record<string, unknown> | undefined)?.IndexFlatIP,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate as FaissIndexFlatIPCtor;
    }
  }
  return null;
}

export function createMockIndexFlatIP(): FaissIndexFlatIPCtor {
  class MockIndex implements FaissIndex {
    vectors: Float32Array[] = [];

    add(v: Float32Array | number[]) {
      this.vectors.push(Float32Array.from(v));
    }

    search(q: Float32Array | number[], k: number): FaissSearchResult {
      const qVec = Float32Array.from(q);
      const distances = this.vectors.map((v) => cosineSimilarity(qVec, v));
      const indices = distances
        .map((_, i) => i)
        .sort((a, b) => distances[b] - distances[a])
        .slice(0, k);
      return {
        distances: new Float32Array(indices.map((i) => distances[i])),
        indices: new Int32Array(indices),
      };
    }

    write() {}

    static read(_filename: string): MockIndex {
      return new MockIndex();
    }
  }

  return MockIndex as unknown as FaissIndexFlatIPCtor;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

let cachedCtor: FaissIndexFlatIPCtor | null | undefined;

export async function loadFaissIndexFlatIP(): Promise<FaissIndexFlatIPCtor> {
  if (cachedCtor) return cachedCtor;

  try {
    const mod = (await import("faiss-node")) as unknown as Record<string, unknown>;
    const IndexFlatIP = resolveIndexFlatIP(mod);
    if (!IndexFlatIP) {
      throw new Error("faiss-node IndexFlatIP export not found (ESM interop)");
    }
    cachedCtor = IndexFlatIP;
    return IndexFlatIP;
  } catch (err) {
    console.error("[aio] faiss-node unavailable, using in-memory mock index:", err);
    cachedCtor = createMockIndexFlatIP();
    return cachedCtor;
  }
}

/** Test helper */
export function resetFaissCache(): void {
  cachedCtor = undefined;
}
