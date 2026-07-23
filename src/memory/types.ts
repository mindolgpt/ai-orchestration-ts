export type MemoryKind = 'why' | 'correction' | 'constraint' | 'context'
export type AnchorType = 'document' | 'epic' | 'spec' | 'code'
export type Confidence = 'proposed' | 'confirmed'

export interface MemoryEntry {
  id: string
  kind: MemoryKind
  anchorType: AnchorType
  anchorId: string
  content: string
  provenance: {
    author: string
    confidence: Confidence
    recordedAt: number
  }
  version: number
  supersededBy?: string
}

export interface MemoryStoreEntry {
  id: string
  kind: MemoryKind
  anchorType: AnchorType
  anchorId: string
  content: string
  author: string
  confidence: Confidence
  recordedAt: number
  version: number
  supersededBy?: string | null
}

export interface MemorySearchResult {
  id: string
  kind: MemoryKind
  anchorType: AnchorType
  anchorId: string
  snippet: string
  score: number
}
