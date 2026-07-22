/**
 * Detect the set of programming languages used in a project by scanning
 * package manifests, lock files and source extensions. Used by the harness
 * wizard so language-optimized rules can be injected into tool rule files.
 *
 * Detection intentionally favors recall over precision: a project mixing
 * TypeScript and Rust (e.g. NAPI) should surface both. False positives are
 * filtered later by the interview + user confirmation.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { LANGUAGE_RULES, LanguageId, ALL_LANGUAGE_IDS } from '@/harness/language-rules'

export interface DetectedLanguage {
  id: LanguageId
  label: string
  /** Why we think this language is present */
  evidence: string
  /** 0..n — higher is more confident */
  confidence: number
}

export interface LanguageDetectionResult {
  languages: DetectedLanguage[]
  /** Best guess for the primary language (highest confidence) */
  primary?: DetectedLanguage
  /** Raw list of manifest/lock files found in the project root */
  found_manifests: string[]
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function listDirectory(p: string): Promise<string[] | null> {
  try {
    return await fs.readdir(p)
  } catch {
    return null
  }
}

async function readJsonSafe(p: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

async function detectFromManifests(root: string): Promise<DetectedLanguage[]> {
  const found: DetectedLanguage[] = []
  const foundManifests: string[] = []

  // Single-file manifests first.
  for (const langId of ALL_LANGUAGE_IDS) {
    const rules = LANGUAGE_RULES[langId]
    for (const manifest of rules.manifests) {
      // Skip glob manifests (handled separately below).
      if (manifest.includes('*')) continue
      const p = path.join(root, manifest)
      if (await pathExists(p)) {
        foundManifests.push(manifest)
        found.push({
          id: langId,
          label: rules.label,
          evidence: `found ${manifest}`,
          confidence: 3,
        })
      }
    }
  }

  // package.json inspection — language is a hint, not authoritative
  const pkg = await readJsonSafe(path.join(root, 'package.json'))
  if (pkg) {
    foundManifests.push('package.json')
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    } as Record<string, string>
    const tsSignals = ['typescript', 'tsx', 'vitest', '@typescript-eslint']
    const jsSignals = ['eslint', 'prettier', 'jest', 'mocha', 'express', 'fastify', 'next']
    const tsHit = tsSignals.some((k) => k in deps)
    const jsHit = jsSignals.some((k) => k in deps)
    if (tsHit && !found.some((d) => d.id === 'typescript')) {
      found.push({
        id: 'typescript',
        label: LANGUAGE_RULES.typescript.label,
        evidence: 'package.json has typescript tooling',
        confidence: 3,
      })
    }
    if (!tsHit && jsHit && !found.some((d) => d.id === 'javascript')) {
      found.push({
        id: 'javascript',
        label: LANGUAGE_RULES.javascript.label,
        evidence: 'package.json has JS-only tooling',
        confidence: 2,
      })
    }
    // react-native etc. intentionally fall back to typescript defaults — covered
    // later via stack detection in language-rules.detectLanguagesFromStacks.
  }

  // Globbed manifests (e.g. *.csproj, *.gemspec, *.xcodeproj)
  const dirEntries = (await listDirectory(root)) || []
  for (const langId of ALL_LANGUAGE_IDS) {
    const rules = LANGUAGE_RULES[langId]
    for (const manifest of rules.manifests) {
      if (!manifest.includes('*')) continue
      const pattern = manifest.replace(/^\*/, '')
      const match = dirEntries.find((e) => e.endsWith(pattern) && !e.startsWith('.'))
      if (match) {
        foundManifests.push(match)
        if (!found.some((d) => d.id === langId)) {
          found.push({
            id: langId,
            label: rules.label,
            evidence: `found ${match}`,
            confidence: 3,
          })
        }
      }
    }
  }

  // build.gradle.kts boosts kotlin (over java) for detection
  if (found.some((d) => d.id === 'java' && d.evidence === 'found build.gradle')) {
    if (await pathExists(path.join(root, 'build.gradle.kts'))) {
      found.push({
        id: 'kotlin',
        label: LANGUAGE_RULES.kotlin.label,
        evidence: 'found build.gradle.kts',
        confidence: 3,
      })
    }
  }

  return found
}

async function detectFromSourceExtensions(root: string, maxDepth = 3): Promise<DetectedLanguage[]> {
  const counts: Partial<Record<LanguageId, number>> = {}
  const extToLang = new Map<string, LanguageId>()
  for (const langId of ALL_LANGUAGE_IDS) {
    for (const ext of LANGUAGE_RULES[langId].extensions) {
      extToLang.set(ext, langId)
    }
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    const entries = await listDirectory(dir)
    if (!entries) return
    // Skip heavy/irrelevant directories
    const skip = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      'target',
      '.venv',
      'venv',
      '__pycache__',
      '.next',
      'coverage',
      '.cache',
    ])
    for (const entry of entries) {
      if (skip.has(entry)) continue
      const full = path.join(dir, entry)
      const stat = await fs.stat(full).catch(() => null)
      if (!stat) continue
      if (stat.isDirectory()) {
        await walk(full, depth + 1)
      } else {
        const ext = path.extname(entry).toLowerCase()
        const lang = extToLang.get(ext)
        if (lang) counts[lang] = (counts[lang] || 0) + 1
      }
    }
  }

  await walk(root, 0)

  const found: DetectedLanguage[] = []
  for (const [id, count] of Object.entries(counts)) {
    found.push({
      id: id as LanguageId,
      label: LANGUAGE_RULES[id as LanguageId].label,
      evidence: `${count} source file(s) matched extensions`,
      confidence: Math.min(count, 5),
    })
  }
  return found
}

/**
 * Detect languages in the project. Order of precedence:
 *  1. package.json / pyproject.toml / go.mod etc. (highest weight)
 *  2. source file extensions sampled from the root (lower weight, tie-breaker)
 *
 * Output is de-duplicated by language id with summed confidence.
 */
export async function detectLanguages(projectRoot?: string): Promise<LanguageDetectionResult> {
  const root = path.resolve(projectRoot || process.cwd())
  const fromManifests = await detectFromManifests(root)
  const fromSource = await detectFromSourceExtensions(root)

  const foundManifests = fromManifests
    .map((d) => d.evidence.replace(/^found /, ''))
    .filter((m) => !m.includes('package.json'))

  const merged = new Map<LanguageId, DetectedLanguage>()
  for (const d of [...fromManifests, ...fromSource]) {
    const existing = merged.get(d.id)
    if (!existing) {
      merged.set(d.id, { ...d })
    } else {
      existing.confidence += d.confidence
      existing.evidence = `${existing.evidence}; ${d.evidence}`
    }
  }

  const languages = [...merged.values()].sort((a, b) => b.confidence - a.confidence)
  const primary = languages[0]

  return { languages, primary, found_manifests: foundManifests }
}

export { LANGUAGE_RULES, ALL_LANGUAGE_IDS }
