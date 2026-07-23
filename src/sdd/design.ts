import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { SddDesign, SddSpec, TechnicalKickoffPacket } from './types'
import {
  computeDesignRevision,
  computeEvidenceFingerprint,
  computeProductFingerprint,
} from './revision'

export interface DesignStore {
  list(): Promise<SddDesign[]>
  get(id: string): Promise<SddDesign | undefined>
  save(design: SddDesign): Promise<void>
}

export class FileDesignStore implements DesignStore {
  private dir: string

  constructor(baseDir: string) {
    this.dir = path.join(baseDir, 'sdd')
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  async list(): Promise<SddDesign[]> {
    try {
      const files = await fs.readdir(this.dir)
      const designs: SddDesign[] = []
      for (const f of files) {
        if (f.endsWith('.json')) {
          try {
            const data = await fs.readFile(path.join(this.dir, f), 'utf-8')
            const parsed = JSON.parse(data) as Partial<SddDesign>
            if (parsed.specId) designs.push(parsed as SddDesign)
          } catch {
            /* skip */
          }
        }
      }
      return designs.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }

  async get(id: string): Promise<SddDesign | undefined> {
    try {
      const data = await fs.readFile(this.filePath(id), 'utf-8')
      return JSON.parse(data) as SddDesign
    } catch {
      return undefined
    }
  }

  async save(design: SddDesign): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(this.filePath(design.id), JSON.stringify(design, null, 2), 'utf-8')
  }
}

export function createDesign(spec: SddSpec, projectRoot: string): SddDesign {
  const id = `design_${randomUUID().slice(0, 8)}`
  const now = Date.now()
  const productFp = computeProductFingerprint(spec.revision, spec.revision)
  const evidenceFp = computeEvidenceFingerprint([], {})

  const body = formatDefaultDesignBody(spec)
  const revision = computeDesignRevision(body, productFp, evidenceFp)

  return {
    id,
    specId: spec.id,
    status: 'draft',
    designRevision: revision,
    productFingerprint: productFp,
    evidenceFingerprint: evidenceFp,
    systemDesignPath: path.join(projectRoot, '.aio', 'sdd', id, 'system_design.md'),
    createdAt: now,
  }
}

function formatDefaultDesignBody(spec: SddSpec): string {
  return [
    `# System Design: ${spec.title}`,
    '',
    `Spec: ${spec.id}`,
    '',
    '## 1. Meeting Goal',
    '',
    '## 2. Product Understanding',
    '',
    '## 3. AS-IS Structure',
    '',
    '## 4. TO-BE Structure',
    '',
    '## 5. Component Change Map',
    '',
    '## 6. Detailed Contracts',
    '',
    '## 7. Rules & Constraints',
    '',
    '## 8. Implementation Packets',
    '',
    '## 9. Migration & Release',
    '',
    '## 10. Verification',
    '',
    '## 11. Open Decisions',
    '',
    '## Appendix A: Evidence',
    '',
  ].join('\n')
}

export async function writeDesignFile(design: SddDesign, body: string): Promise<void> {
  const dir = path.dirname(design.systemDesignPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(design.systemDesignPath, body, 'utf-8')
}

export async function readDesignFile(design: SddDesign): Promise<string> {
  const data = await fs.readFile(design.systemDesignPath, 'utf-8')
  return data
}

export function buildKickoffPacket(_spec: SddSpec): TechnicalKickoffPacket {
  return {
    autoDecisions: [],
    evidenceResolutionItems: [],
    technicalOwnerQuestions: [],
  }
}
