import { OpenAI } from 'openai'
import { assertTrustedLocalEmbeddingModel } from '@/security/embedding-model'

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
  embedOne(text: string): Promise<number[]>
  dimension: number
}

interface FeatureExtractionPipeline {
  (text: string, options: { pooling: string; normalize: boolean }): Promise<{ data: Float32Array }>
}

export class OpenAIEmbedder implements Embedder {
  private client: OpenAI
  private model: string
  public dimension: number = 1536

  constructor(apiKey: string, model = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey })
    this.model = model
    if (model === 'text-embedding-3-large') this.dimension = 3072
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      encoding_format: 'float',
    })
    return response.data.map((d) => d.embedding)
  }

  async embedOne(text: string): Promise<number[]> {
    const result = await this.embed([text])
    return result[0]
  }
}

export class LocalEmbedder implements Embedder {
  public dimension: number = 384
  private pipeline: FeatureExtractionPipeline | null = null

  constructor(private modelName = 'Xenova/multilingual-e5-small') {
    assertTrustedLocalEmbeddingModel(this.modelName)
  }

  private async loadPipeline() {
    if (this.pipeline) return
    assertTrustedLocalEmbeddingModel(this.modelName)
    const { pipeline } = await import('@xenova/transformers')
    this.pipeline = (await pipeline(
      'feature-extraction',
      this.modelName
    )) as FeatureExtractionPipeline
    this.dimension = (await this.pipeline('test', { pooling: 'mean', normalize: true })).data.length
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    await this.loadPipeline()
    const results = await Promise.all(
      texts.map((t) => this.pipeline!(t, { pooling: 'mean', normalize: true }))
    )
    return results.map((r) => Array.from(r.data))
  }

  async embedOne(text: string): Promise<number[]> {
    const result = await this.embed([text])
    return result[0]
  }
}

export function createEmbedder(): Embedder {
  const provider = process.env.EMBEDDING_PROVIDER || 'local'
  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY required for OpenAI embedder')
    return new OpenAIEmbedder(apiKey, process.env.EMBEDDING_MODEL)
  }
  return new LocalEmbedder(process.env.LOCAL_EMBEDDING_MODEL)
}
