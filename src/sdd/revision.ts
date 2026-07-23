import { createHash } from 'crypto'

export function computeRevision(body: string): string {
  return createHash('sha256').update(body, 'utf-8').digest('hex')
}

export function computeProductFingerprint(
  requestRevision: string,
  storiesRevision: string
): string {
  return createHash('sha256').update(`${requestRevision}:${storiesRevision}`, 'utf-8').digest('hex')
}

export function computeEvidenceFingerprint(
  evidenceIds: string[],
  commits: Record<string, string>
): string {
  const sorted = [...evidenceIds].sort()
  const commitStr = Object.entries(commits)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
  return createHash('sha256')
    .update(`${sorted.join(',')}|${commitStr}`, 'utf-8')
    .digest('hex')
}

export function computeDesignRevision(body: string, productFp: string, evidenceFp: string): string {
  return createHash('sha256').update(`${body}|${productFp}|${evidenceFp}`, 'utf-8').digest('hex')
}

export function compareRevisions(actual: string, expected: string): boolean {
  return actual === expected
}

export interface RevisionManifest {
  schemaVersion: string
  requestRevision: string
  storiesRevision: string
  productInputFingerprint: string
  evidenceFingerprint: string
  designRevision: string
  approvedRevision?: string
  approvedAt?: number
  approvedBy?: string
}
