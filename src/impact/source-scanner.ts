import * as fs from 'fs/promises'
import * as path from 'path'

export interface BoundedSourceRead {
  filePath: string
  lines: string[]
  commit?: string
  exists: boolean
}

export interface ScanConfig {
  roots: string[]
  include?: string[]
  exclude?: string[]
}

export async function readBoundedSource(
  filePath: string,
  lineRange?: [number, number]
): Promise<BoundedSourceRead> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const allLines = content.split('\n')

    let lines: string[]
    if (lineRange) {
      const [start, end] = lineRange
      lines = allLines.slice(Math.max(0, start - 1), end)
    } else {
      lines = allLines
    }

    return {
      filePath,
      lines,
      exists: true,
    }
  } catch {
    return { filePath, lines: [], exists: false }
  }
}

export async function findRelatedFiles(
  symbol: string,
  roots: string[],
  maxResults = 20
): Promise<string[]> {
  const results: string[] = []

  for (const root of roots) {
    await findInDir(root, symbol, results, maxResults)
    if (results.length >= maxResults) break
  }

  return results.slice(0, maxResults)
}

async function findInDir(
  dir: string,
  symbol: string,
  results: string[],
  max: number
): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= max) return
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          await findInDir(fullPath, symbol, results, max)
        }
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8')
          if (content.includes(symbol)) {
            results.push(fullPath)
          }
        } catch {
          /* skip unreadable */
        }
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
}
