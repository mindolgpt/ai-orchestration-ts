import * as fs from 'fs/promises'
import * as path from 'path'

/** True when `target` resolves inside `root` (or equals root). */
export function isPathInsideRoot(root: string, target: string): boolean {
  const rootAbs = path.resolve(root)
  const targetAbs = path.resolve(target)
  const rel = path.relative(rootAbs, targetAbs)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function assertPathInsideRoots(absPath: string, roots: string[]): void {
  const resolved = path.resolve(absPath)
  const ok = roots.some((r) => isPathInsideRoot(path.resolve(r), resolved))
  if (!ok) {
    throw new Error(
      `path must stay under allowed roots (got ${resolved}). Allowed: ${roots.map((r) => path.resolve(r)).join(', ')}`
    )
  }
}

/** Resolve symlinks and verify the real path stays inside allowed roots. */
export async function resolveRealPathInsideRoots(
  absPath: string,
  roots: string[]
): Promise<string> {
  const real = await fs.realpath(absPath)
  assertPathInsideRoots(real, roots)
  return real
}

/**
 * Resolve scan/tool paths under `rootDir`. Rejects `..` / absolute escapes.
 * Returns paths relative to root (posix), suitable for `rg` cwd=rootDir.
 */
export function resolveContainedRelPaths(rootDir: string, paths: string[] | undefined): string[] {
  const root = path.resolve(rootDir)
  const targets = paths?.length ? paths : ['.']
  const out: string[] = []
  for (const entry of targets) {
    const abs = path.isAbsolute(entry) ? path.resolve(entry) : path.resolve(root, entry)
    if (!isPathInsideRoot(root, abs)) {
      throw new Error(
        `path escapes project root: ${entry} (resolved ${abs}). Must stay under ${root}`
      )
    }
    const rel = path.relative(root, abs).replace(/\\/g, '/')
    out.push(rel === '' ? '.' : rel)
  }
  return out
}
