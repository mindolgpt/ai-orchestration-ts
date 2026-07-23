import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { SddSpec, SddSpecInput } from './types'
import { computeRevision } from './revision'

export interface SpecStore {
  list(): Promise<SddSpec[]>
  get(id: string): Promise<SddSpec | undefined>
  save(spec: SddSpec): Promise<void>
  delete(id: string): Promise<void>
}

export class FileSpecStore implements SpecStore {
  private dir: string

  constructor(baseDir: string) {
    this.dir = path.join(baseDir, '.aio', 'sdd', 'meta', 'specs')
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  async list(): Promise<SddSpec[]> {
    try {
      const files = await fs.readdir(this.dir)
      const specs: SddSpec[] = []
      for (const f of files) {
        if (f.endsWith('.json')) {
          const data = await fs.readFile(path.join(this.dir, f), 'utf-8')
          specs.push(JSON.parse(data) as SddSpec)
        }
      }
      return specs.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }

  async get(id: string): Promise<SddSpec | undefined> {
    try {
      const data = await fs.readFile(this.filePath(id), 'utf-8')
      return JSON.parse(data) as SddSpec
    } catch {
      return undefined
    }
  }

  async save(spec: SddSpec): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(this.filePath(spec.id), JSON.stringify(spec, null, 2), 'utf-8')
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(id))
    } catch {
      /* ignore */
    }
  }
}

export function createSpec(input: SddSpecInput, projectRoot: string): SddSpec {
  const id = `spec_${randomUUID().slice(0, 8)}`
  const now = Date.now()
  const body = formatSpecBody(input)
  const revision = computeRevision(body)

  return {
    id,
    projectId: input.project,
    title: input.title,
    status: 'draft',
    revision,
    prdPath: path.join(projectRoot, '.aio', 'sdd', id, 'prd.md'),
    storiesPath: path.join(projectRoot, '.aio', 'sdd', id, 'user_stories.md'),
    createdAt: now,
    productContext: input.productContext,
    requirements: input.requirements,
  }
}

function formatSpecBody(input: SddSpecInput): string {
  const lines: string[] = [
    `# ${input.title}`,
    '',
    `Project: ${input.project}`,
    '',
    '## Product Context',
    '',
    input.productContext,
    '',
    '## Requirements',
    '',
  ]
  for (const req of input.requirements) {
    lines.push(`### [${req.priority}] ${req.id}: ${req.description}`)
    if (req.acceptanceCriteria?.length) {
      for (const ac of req.acceptanceCriteria) {
        lines.push(`- AC: ${ac}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

export async function writeSpecFiles(spec: SddSpec, input: SddSpecInput): Promise<void> {
  const dir = path.dirname(spec.prdPath)
  await fs.mkdir(dir, { recursive: true })

  const prd = formatSpecBody(input)
  await fs.writeFile(spec.prdPath, prd, 'utf-8')

  const stories = formatUserStories(input)
  await fs.writeFile(spec.storiesPath, stories, 'utf-8')
}

function formatUserStories(input: SddSpecInput): string {
  const lines: string[] = [`# User Stories: ${input.title}`, '', `Project: ${input.project}`, '']
  for (const req of input.requirements) {
    lines.push(`## ${req.id}: ${req.description}`, '')
    if (req.acceptanceCriteria?.length) {
      for (let i = 0; i < req.acceptanceCriteria.length; i++) {
        lines.push(`### Story ${req.id}-S${i + 1}`)
        lines.push('')
        lines.push(
          `As a user, I want ${req.description.toLowerCase()} so that ${req.acceptanceCriteria[i].toLowerCase()}`
        )
        lines.push('')
      }
    }
  }
  return lines.join('\n')
}
