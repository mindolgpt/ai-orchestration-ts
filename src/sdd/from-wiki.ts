import * as fs from 'fs/promises'
import * as path from 'path'
import { SddSpec, SddDesign, SddRequirement } from '@/sdd/types'
import { formatDefaultDesignBody } from '@/sdd/design'
import { DomainProfile } from '@/harness/types'

export interface WikiEnrichInput {
  projectRoot: string
  spec: SddSpec
  requirements: SddRequirement[]
  profile?: DomainProfile
  asIsMarkdown?: string
  wikiExcerpts?: Array<{ title: string; excerpt: string }>
  frontend?: string
  backend?: string
}

export interface AcceptanceItem {
  id: string
  description: string
  status: 'pending' | 'pass' | 'fail'
  evidence?: string
}

export function buildEnrichedDesignBody(input: WikiEnrichInput): string {
  const base = formatDefaultDesignBody(input.spec)
  const wikiBits = (input.wikiExcerpts || [])
    .slice(0, 8)
    .map((w) => `- [[${w.title}]]: ${w.excerpt.slice(0, 200)}`)
    .join('\n')
  const reqLines = input.requirements
    .map(
      (r) =>
        `- **${r.id}** (${r.priority}): ${r.description}` +
        (r.acceptanceCriteria?.length ? `\n  - AC: ${r.acceptanceCriteria.join('; ')}` : '')
    )
    .join('\n')

  const filled = base
    .replace(
      '## 1. Meeting Goal\n\n',
      `## 1. Meeting Goal\n\nAlign implementation of **${input.spec.title}** with wiki + stack (${input.frontend || '?'} / ${input.backend || '?'}).\n\n`
    )
    .replace(
      '## 2. Product Understanding\n\n',
      `## 2. Product Understanding\n\nDomain: ${input.profile?.domain || 'general'}\n\n${input.profile?.description || ''}\n\n### Requirements\n\n${reqLines || '- (none)'}\n\n### Wiki citations\n\n${wikiBits || '- (none)'}\n\n`
    )
    .replace(
      '## 3. AS-IS Structure\n\n',
      `## 3. AS-IS Structure\n\n${input.asIsMarkdown || 'Greenfield — no existing application source.'}\n\n`
    )
    .replace(
      '## 4. TO-BE Structure\n\n',
      `## 4. TO-BE Structure\n\n- Frontend: ${input.frontend || 'tbd'} (\`apps/web\`)\n- Backend: ${input.backend || 'tbd'} (\`apps/api\`)\n- Contracts: \`packages/contracts\`\n- Follow architecture methodology in \`.aio/architecture-methodology.md\`\n\n`
    )
    .replace(
      '## 6. Detailed Contracts\n\n',
      `## 6. Detailed Contracts\n\n- Own shared schemas in \`packages/contracts\`\n- Version DTOs; FE/BE import only from contracts\n\n`
    )
    .replace(
      '## 10. Verification\n\n',
      `## 10. Verification\n\n- DoD: build, lint, typecheck, test, acceptance\n- Cite wiki pages / AC ids in PRs\n\n`
    )

  return filled
}

export function buildTasksMarkdown(
  design: SddDesign,
  spec: SddSpec | undefined,
  requirements: SddRequirement[],
  opts?: { frontend?: string; backend?: string }
): string {
  const rows = [
    '| # | Module | Action | File | Status |',
    '|---|--------|--------|------|--------|',
    `| 1 | contracts | Define shared DTOs | packages/contracts/src | pending |`,
    `| 2 | backend (${opts?.backend || 'api'}) | Implement P0 APIs | apps/api | pending |`,
    `| 3 | frontend (${opts?.frontend || 'web'}) | Implement P0 UI | apps/web | pending |`,
    `| 4 | verify | DoD ladder | CI | pending |`,
  ]
  let n = 5
  for (const r of requirements.slice(0, 12)) {
    rows.push(`| ${n++} | feature | ${r.description.slice(0, 60)} | — | pending |`)
  }

  return [
    '---',
    `schemaVersion: sdd-tasks.v1`,
    `designSchemaVersion: sdd-design.v1`,
    `designRevision: ${design.designRevision}`,
    `approvedRevision: ${design.approvedRevision || 'none'}`,
    `executionReadiness: ${spec?.status === 'approved' ? 'ready' : 'blocked'}`,
    '---',
    '',
    '# Implementation Tasks',
    '',
    `Design: ${design.id}`,
    `Spec: ${spec?.id || 'unknown'}`,
    '',
    '## Module Execution Table',
    '',
    ...rows,
    '',
    '## RED / GREEN Loop',
    '',
    '1. Write failing test (RED)',
    '2. Implement minimal change (GREEN)',
    '3. Run regression tests + typecheck',
    '4. Self-review for spec coverage + wiki cites',
    '5. Update packages/contracts when APIs change',
    '',
  ].join('\n')
}

export async function writeAcceptanceJson(
  projectRoot: string,
  specId: string,
  requirements: SddRequirement[]
): Promise<string> {
  const items: AcceptanceItem[] = []
  for (const r of requirements) {
    const acs = r.acceptanceCriteria?.length ? r.acceptanceCriteria : [r.description]
    acs.forEach((ac, i) => {
      items.push({
        id: `${r.id}-AC${i + 1}`,
        description: ac,
        status: 'pending',
      })
    })
  }
  const dir = path.join(projectRoot, '.aio', 'sdd', specId)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'acceptance.json')
  await fs.writeFile(file, JSON.stringify({ specId, items }, null, 2), 'utf-8')
  return file
}

export interface AcceptanceFile {
  specId: string
  items: AcceptanceItem[]
}

/** Locate a spec's acceptance.json, or the newest one if specId is omitted. */
async function resolveAcceptancePath(projectRoot: string, specId?: string): Promise<string | null> {
  const sddRoot = path.join(projectRoot, '.aio', 'sdd')
  if (specId) {
    const p = path.join(sddRoot, specId, 'acceptance.json')
    try {
      await fs.access(p)
      return p
    } catch {
      return null
    }
  }
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = await fs.readdir(sddRoot, { withFileTypes: true })
  } catch {
    return null
  }
  const candidates: Array<{ f: string; t: number }> = []
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name === 'meta') continue
    const f = path.join(sddRoot, ent.name, 'acceptance.json')
    try {
      const st = await fs.stat(f)
      candidates.push({ f, t: st.mtimeMs })
    } catch {
      /* skip */
    }
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.t - a.t)
  return candidates[0].f
}

/**
 * Mark acceptance-criteria items as pass/fail. This is the missing link that
 * lets the verify ladder's `acceptance` step actually pass: an agent (or the
 * `report_acceptance` MCP tool) records which AC ids are satisfied, with
 * optional evidence, instead of items staying `pending` forever.
 */
export async function markAcceptanceItems(
  projectRoot: string,
  updates: Array<{ id: string; status: 'pass' | 'fail' | 'pending'; evidence?: string }>,
  opts?: { specId?: string }
): Promise<{
  file: string
  updated: string[]
  unknown: string[]
  all_pass: boolean
  items: AcceptanceItem[]
}> {
  const file = await resolveAcceptancePath(projectRoot, opts?.specId)
  if (!file) {
    throw new Error(
      'No acceptance.json found. Run bootstrap_product/SDD spec creation first (writeAcceptanceJson).'
    )
  }
  const raw = await fs.readFile(file, 'utf-8')
  const data = JSON.parse(raw) as AcceptanceFile
  const byId = new Map(data.items.map((i) => [i.id, i]))
  const updated: string[] = []
  const unknown: string[] = []
  for (const u of updates) {
    const item = byId.get(u.id)
    if (!item) {
      unknown.push(u.id)
      continue
    }
    item.status = u.status
    if (u.evidence !== undefined) item.evidence = u.evidence
    updated.push(u.id)
  }
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
  const all_pass = data.items.length > 0 && data.items.every((i) => i.status === 'pass')
  return { file, updated, unknown, all_pass, items: data.items }
}
