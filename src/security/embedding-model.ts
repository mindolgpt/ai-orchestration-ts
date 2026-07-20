/**
 * Restrict local embedding model IDs to trusted org prefixes (HF Hub supply-chain).
 * Override with AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL=1.
 */

const TRUSTED_PREFIXES = ['Xenova/', 'onnx-community/']

export function assertTrustedLocalEmbeddingModel(modelName: string): void {
  if (process.env.AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL === '1') return
  const name = (modelName || '').trim()
  if (!name) return
  if (TRUSTED_PREFIXES.some((p) => name.startsWith(p))) return
  throw new Error(
    `LOCAL_EMBEDDING_MODEL "${name}" is not in the trusted allowlist ` +
      `(${TRUSTED_PREFIXES.join(', ')}). Set AIO_ALLOW_UNTRUSTED_EMBEDDING_MODEL=1 to override.`
  )
}
