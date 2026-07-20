import * as fs from 'fs/promises'
import * as path from 'path'
import yaml from 'js-yaml'
import { ObsidianVault } from '@/knowledge/vault'
import { resolveProjectRoot } from '@/knowledge/paths'
import { DEFAULT_DOMAIN_PROFILE, DomainProfile } from '@/harness/types'

const PROFILE_NAME = 'domain-profile.yaml'

export function profilePath(projectRoot?: string): string {
  return path.join(projectRoot || resolveProjectRoot(), '.aio', PROFILE_NAME)
}

export function vaultProfilePath(vaultRoot: string): string {
  return path.join(vaultRoot, PROFILE_NAME)
}

function mergeProfile(base: DomainProfile, partial: Partial<DomainProfile>): DomainProfile {
  return {
    ...base,
    ...partial,
    stack: { ...base.stack, ...partial.stack },
    wiki: { ...base.wiki, ...partial.wiki },
    loop: { ...base.loop, ...partial.loop },
    harness: { ...base.harness, ...partial.harness },
  }
}

/** Parse wiki/index.md bullet lines for default overview page slugs */
export async function inferOverviewPagesFromWiki(vault: ObsidianVault): Promise<string[]> {
  await vault.initialize()
  const index = await vault.readNote('wiki/index.md')
  if (!index) return []
  const slugs: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(index)) !== null) {
    const slug = m[1].split('|')[0].trim()
    if (slug && slug !== 'index' && slug !== 'log') slugs.push(slug)
  }
  return slugs.slice(0, 8)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Infer stack from package.json, pom.xml, go.mod, etc. */
export async function inferStackFromProject(
  projectRoot?: string
): Promise<NonNullable<DomainProfile['stack']>> {
  const root = projectRoot || resolveProjectRoot()
  const stack: NonNullable<DomainProfile['stack']> = {}

  try {
    const raw = await fs.readFile(path.join(root, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.next) stack.frontend = 'next.js'
    else if (deps.react) stack.frontend = 'react'
    else if (deps.vue) stack.frontend = 'vue'
    else if (deps.nuxt) stack.frontend = 'nuxt'
    else if (deps['@angular/core']) stack.frontend = 'angular'
    if (deps.express) stack.backend = 'express'
    else if (deps.fastify) stack.backend = 'fastify'
    else if (deps.nestjs || deps['@nestjs/core']) stack.backend = 'nestjs'
  } catch {
    /* no package.json */
  }

  if (await pathExists(path.join(root, 'pom.xml'))) stack.backend = stack.backend || 'spring-boot'
  if (
    (await pathExists(path.join(root, 'build.gradle.kts'))) ||
    (await pathExists(path.join(root, 'build.gradle')))
  ) {
    stack.backend = stack.backend || 'kotlin-spring'
  }
  if (await pathExists(path.join(root, 'go.mod'))) stack.backend = stack.backend || 'go'
  if (await pathExists(path.join(root, 'Cargo.toml'))) stack.backend = stack.backend || 'rust'
  if (await pathExists(path.join(root, 'pyproject.toml')))
    stack.backend = stack.backend || 'fastapi'

  return stack
}

export async function inferStackFromWikiStacks(
  vault: ObsidianVault
): Promise<NonNullable<DomainProfile['stack']>> {
  await vault.initialize()
  const stacks: string[] = []
  const notes = await vault.listNotes('wiki/stacks/')
  for (const n of notes) {
    const name = n.replace(/^wiki\/stacks\//, '').replace(/\.md$/, '')
    if (name) stacks.push(name)
  }
  const stack: NonNullable<DomainProfile['stack']> = {}
  const joined = stacks.join(' ').toLowerCase()
  if (/react|next|vue|angular|svelte/.test(joined)) {
    if (joined.includes('next')) stack.frontend = 'next.js'
    else if (joined.includes('react')) stack.frontend = 'react'
    else if (joined.includes('vue')) stack.frontend = 'vue'
  }
  if (/spring|kotlin|express|fastapi|django|nestjs|go|rust/.test(joined)) {
    if (joined.includes('spring')) stack.backend = 'spring-boot'
    else if (joined.includes('express')) stack.backend = 'express'
    else if (joined.includes('fastapi')) stack.backend = 'fastapi'
  }
  return stack
}

export async function enrichDomainProfile(
  vault: ObsidianVault,
  profile: DomainProfile,
  projectRoot?: string
): Promise<DomainProfile> {
  const fromProject = await inferStackFromProject(projectRoot)
  const fromWiki = await inferStackFromWikiStacks(vault)
  return {
    ...profile,
    stack: {
      ...fromWiki,
      ...fromProject,
      ...profile.stack,
    },
  }
}

export async function loadDomainProfile(
  vault: ObsidianVault,
  projectRoot?: string
): Promise<{ profile: DomainProfile; path: string; source: 'project' | 'vault' | 'default' }> {
  const root = projectRoot || resolveProjectRoot()
  const candidates = [profilePath(root), vaultProfilePath(vault.rootPath)]

  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8')
      const parsed = yaml.load(raw) as Partial<DomainProfile>
      if (parsed && typeof parsed === 'object') {
        return {
          profile: mergeProfile(DEFAULT_DOMAIN_PROFILE, parsed),
          path: p,
          source: p.includes(vault.rootPath) ? 'vault' : 'project',
        }
      }
    } catch {
      /* try next */
    }
  }

  const overview = await inferOverviewPagesFromWiki(vault)
  const profile = mergeProfile(DEFAULT_DOMAIN_PROFILE, {
    name: overview.length ? 'wiki-inferred' : 'default',
    domain: overview.length ? 'wiki' : 'general',
    description: 'Auto-inferred from vault wiki index',
    wiki: { overview_pages: overview.slice(0, 5) },
  })

  return { profile, path: profilePath(root), source: 'default' }
}

export async function saveDomainProfile(
  profile: DomainProfile,
  projectRoot?: string
): Promise<string> {
  const p = profilePath(projectRoot)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, yaml.dump(profile, { lineWidth: 100 }), 'utf-8')
  return p
}
