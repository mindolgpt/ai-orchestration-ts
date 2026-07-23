import * as fs from 'fs/promises'
import * as path from 'path'
import { SddDesign, SddSpec, SddTasks } from './types'

export async function generateTasks(
  design: SddDesign,
  spec: SddSpec | undefined,
  baseDir: string
): Promise<SddTasks> {
  const tasks: SddTasks = {
    designId: design.id,
    schemaVersion: 'sdd-tasks.v1',
    designSchemaVersion: 'sdd-design.v1',
    planKind: 'implementation-checklist',
    executionReadiness: spec?.status === 'approved' ? 'ready' : 'blocked',
    tasksPath: path.join(baseDir, 'sdd', design.id, 'tasks.md'),
    createdAt: Date.now(),
  }

  const body = formatTasksBody(design, spec)
  const dir = path.dirname(tasks.tasksPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(tasks.tasksPath, body, 'utf-8')

  return tasks
}

function formatTasksBody(design: SddDesign, spec: SddSpec | undefined): string {
  const lines: string[] = [
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
    '| # | Module | Action | File | Status |',
    '|---|--------|--------|------|--------|',
    '',
  ]

  if (spec?.status !== 'approved') {
    lines.push('> **Blocked**: Spec must be approved before task execution.', '')
  }

  lines.push(
    '',
    '## Execution Preflight',
    '',
    '- [ ] Source parity confirmed',
    '- [ ] Evidence fingerprint matches',
    '- [ ] Design revision matches approved revision',
    '- [ ] Spec status is approved',
    '',
    '## RED / GREEN Loop',
    '',
    '1. Write failing test (RED)',
    '2. Implement minimal change (GREEN)',
    '3. Run regression tests',
    '4. Self-review for spec coverage',
    '5. Commit checkpoint',
    ''
  )

  return lines.join('\n')
}

export async function readTasksFile(tasks: SddTasks): Promise<string> {
  try {
    return await fs.readFile(tasks.tasksPath, 'utf-8')
  } catch {
    return ''
  }
}
