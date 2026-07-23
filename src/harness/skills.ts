import * as fs from 'fs/promises'
import * as path from 'path'
import { DomainProfile } from '@/harness/types'
import { HarnessInterviewAnswers } from '@/harness/bootstrap-interview'

export interface SkillWriteResult {
  path: string
  action: 'created' | 'updated' | 'skipped'
}

async function writeSkill(abs: string, body: string, force: boolean): Promise<SkillWriteResult> {
  try {
    await fs.access(abs)
    if (!force) return { path: abs, action: 'skipped' }
  } catch {
    /* create */
  }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body, 'utf-8')
  return { path: abs, action: force ? 'updated' : 'created' }
}

export async function writeCursorSkills(
  projectRoot: string,
  opts: {
    profile: DomainProfile
    answers?: HarnessInterviewAnswers
    techStackMd?: string
    architectureMd?: string
    languageRulesMd?: string
    force?: boolean
  }
): Promise<SkillWriteResult[]> {
  const force = opts.force === true
  const base = path.join(projectRoot, '.cursor', 'skills')
  const fe = opts.answers?.frontend_framework || opts.profile.stack?.frontend || 'unknown'
  const be = opts.answers?.backend_framework || opts.profile.stack?.backend || 'unknown'

  const domain = `---
name: aio-domain
description: Domain wiki harness for ${opts.profile.domain}
---

# Domain skill

Work on **${opts.profile.domain}**. ${opts.profile.description}

1. Call \`domain_context({ task, format: "path" })\` and read \`.aio/harness-context.json\`.
2. Cite wiki pages; do not invent domain facts.
3. Prefer \`aio_prompt({ message, execute: true })\` for aio tools.
`

  const implement = `---
name: aio-implement
description: Implement loop with DoD verify
---

# Implement skill

1. \`domain_context\` (format path)
2. \`plan_task\` → \`execute_dag\` or \`run_implement_loop\`
3. Definition of Done: build, lint, typecheck, test, acceptance; cite wiki/SDD; update \`packages/contracts\` when APIs change.
4. \`file_back\` durable decisions; \`lint_wiki\` after wiki edits.
`

  const frontend = `---
name: aio-frontend
description: Frontend stack and architecture for ${fe}
---

# Frontend skill

## Tech stack
Framework: **${fe}**
Language: **${opts.answers?.frontend_language || 'typescript'}**

${opts.techStackMd || ''}

## Architecture
${opts.architectureMd || ''}

## Coding rules
${opts.languageRulesMd || ''}

Use \`packages/contracts\` for API types. Do not invent structure that contradicts \`.aio/project-scan.json\` when present.
`

  const backend = `---
name: aio-backend
description: Backend stack and architecture for ${be}
---

# Backend skill

## Tech stack
Framework: **${be}**
Language: **${opts.answers?.backend_language || 'typescript'}**

${opts.techStackMd || ''}

## Architecture
${opts.architectureMd || ''}

## Coding rules
${opts.languageRulesMd || ''}

Expose DTOs via \`packages/contracts\`. Respect dependency rules from architecture methodology.
`

  const files = [
    ['aio-domain', domain],
    ['aio-implement', implement],
    ['aio-frontend', frontend],
    ['aio-backend', backend],
  ] as const

  const results: SkillWriteResult[] = []
  for (const [id, body] of files) {
    results.push(await writeSkill(path.join(base, id, 'SKILL.md'), body, force))
  }
  return results
}
