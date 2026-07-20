import * as fs from 'fs/promises'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Issue } from '@/knowledge/types'
import { MessageInbox } from '@/mcp/inbox'
import { ChildSession, spawnSession, waitForSession } from '@/mcp/tools/session-tools'
import { getEventLog } from '@/observability/events'

const execFileAsync = promisify(execFile)

const ISSUE_PATTERNS: Array<{
  re: RegExp
  severity: Issue['severity']
  label: string
  rg: string
}> = [
  { re: /\bTODO\b/g, severity: 'low', label: 'TODO', rg: '\\bTODO\\b' },
  { re: /\bFIXME\b/g, severity: 'high', label: 'FIXME', rg: '\\bFIXME\\b' },
  { re: /\bHACK\b/g, severity: 'medium', label: 'HACK', rg: '\\bHACK\\b' },
  { re: /\bXXX\b/g, severity: 'medium', label: 'XXX', rg: '\\bXXX\\b' },
  {
    re: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
    severity: 'high',
    label: 'empty-catch',
    rg: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
  },
  { re: /\beval\s*\(/g, severity: 'critical', label: 'eval', rg: '\\beval\\s*\\(' },
]

const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.kt',
])
const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'vault',
  '.aio',
  '.next',
  'vendor',
])

function severityRank(s: Issue['severity']): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[s]
}

function matchGitignore(relPosix: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const p = raw.trim()
    if (!p || p.startsWith('#')) continue
    const negated = p.startsWith('!')
    const pat = negated ? p.slice(1) : p
    const cleaned = pat.replace(/^\//, '').replace(/\/$/, '')
    if (!cleaned) continue
    // simple glob: * and directory prefixes
    const escaped = cleaned
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
    const re = new RegExp(`(^|/)${escaped}(/|$)`)
    if (re.test(relPosix) || relPosix === cleaned || relPosix.startsWith(cleaned + '/')) {
      return !negated
    }
  }
  return false
}

async function loadGitignore(rootDir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(rootDir, '.gitignore'), 'utf-8')
    return raw.split(/\r?\n/)
  } catch {
    return []
  }
}

export class BranchHunt {
  private issues: Issue[] = []
  private scanCount = 0

  constructor(private inbox: MessageInbox) {}

  clear(): void {
    this.issues = []
  }

  getIssues(): Issue[] {
    return [...this.issues]
  }

  async scanPaths(
    rootDir: string,
    paths: string[] | undefined,
    minSeverity: Issue['severity'] = 'low'
  ): Promise<Issue[]> {
    this.scanCount++
    const minRank = severityRank(minSeverity)
    const gitignore = await loadGitignore(rootDir)

    let found = await this.scanWithRg(rootDir, paths, minRank, gitignore)
    if (found === null) {
      found = await this.scanWithWalk(rootDir, paths, minRank, gitignore)
    }

    const seen = new Set(this.issues.map((i) => `${i.file}::${i.description}`))
    const added: Issue[] = []
    for (const issue of found) {
      const key = `${issue.file}::${issue.description}`
      if (seen.has(key)) continue
      seen.add(key)
      this.issues.push(issue)
      added.push(issue)
    }
    await getEventLog().emit('branch.scan', {
      found: added.length,
      total: this.issues.length,
      root: rootDir,
    })
    return added
  }

  private async scanWithRg(
    rootDir: string,
    paths: string[] | undefined,
    minRank: number,
    gitignore: string[]
  ): Promise<Issue[] | null> {
    if (process.env.AIO_DISABLE_RG === '1') return null

    const patterns = ISSUE_PATTERNS.filter((p) => severityRank(p.severity) >= minRank)
    if (!patterns.length) return []

    const targets = paths?.length ? paths : ['.']
    const found: Issue[] = []
    let rgAvailable = false

    for (const { rg, severity, label } of patterns) {
      const args = [
        '--line-number',
        '--no-heading',
        '--color',
        'never',
        '-g',
        '!node_modules',
        '-g',
        '!.git',
        '-g',
        '!dist',
        '-g',
        '!vault',
        '-g',
        '!.aio',
        rg,
        ...targets,
      ]
      try {
        const { stdout } = await execFileAsync('rg', args, {
          cwd: rootDir,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 8_000,
        })
        rgAvailable = true
        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue
          const m = line.match(/^(.+?):(\d+):(.*)$/)
          if (!m) continue
          const rel = m[1].replace(/\\/g, '/')
          if (matchGitignore(rel, gitignore)) continue
          found.push({
            id: `issue_${this.scanCount}_${found.length}`,
            description: `${label} at line ${m[2]}: ${m[3].trim().slice(0, 120)}`,
            file: rel,
            severity,
            resolved: false,
          })
        }
      } catch (err) {
        const e = err as { code?: string | number; status?: number; stdout?: string }
        // exit 1 = no matches for this pattern
        if (e.status === 1 || e.code === 1) {
          rgAvailable = true
          continue
        }
        // rg not installed / other fatal — fall back to walk
        if (!rgAvailable) return null
        continue
      }
    }

    return rgAvailable ? found : null
  }

  private async scanWithWalk(
    rootDir: string,
    paths: string[] | undefined,
    minRank: number,
    gitignore: string[]
  ): Promise<Issue[]> {
    const found: Issue[] = []
    const targets = paths?.length ? paths : ['.']
    for (const rel of targets) {
      const abs = path.resolve(rootDir, rel)
      const files = await this.collectFiles(rootDir, abs, gitignore)
      for (const file of files) {
        let content: string
        try {
          content = await fs.readFile(file, 'utf-8')
        } catch {
          continue
        }
        const lines = content.split('\n')
        const relFile = path.relative(rootDir, file).replace(/\\/g, '/')
        for (const { re, severity, label } of ISSUE_PATTERNS) {
          if (severityRank(severity) < minRank) continue
          for (let i = 0; i < lines.length; i++) {
            re.lastIndex = 0
            if (!re.test(lines[i])) continue
            re.lastIndex = 0
            found.push({
              id: `issue_${this.scanCount}_${found.length}`,
              description: `${label} at line ${i + 1}: ${lines[i].trim().slice(0, 120)}`,
              file: relFile,
              severity,
              resolved: false,
            })
          }
        }
      }
    }
    return found
  }

  private async collectFiles(rootDir: string, abs: string, gitignore: string[]): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string) => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        try {
          const st = await fs.stat(dir)
          if (st.isFile() && CODE_EXT.has(path.extname(dir))) out.push(dir)
        } catch {
          /* ignore */
        }
        return
      }
      for (const e of entries) {
        if (DEFAULT_IGNORE.has(e.name)) continue
        const full = path.join(dir, e.name)
        const rel = path.relative(rootDir, full).replace(/\\/g, '/')
        if (matchGitignore(rel, gitignore)) continue
        if (e.isDirectory()) await walk(full)
        else if (CODE_EXT.has(path.extname(e.name))) out.push(full)
      }
    }
    await walk(abs)
    return out.slice(0, 800)
  }

  async spawnFixes(
    sessions: Map<string, ChildSession>,
    maxSessions: number,
    opts?: { wait?: boolean; timeoutMs?: number; worktree?: boolean; runtime?: string }
  ): Promise<Issue[]> {
    const pending = this.issues.filter((i) => !i.sessionId && !i.resolved)
    for (const issue of pending) {
      const spawnResult = await spawnSession(
        sessions,
        this.inbox,
        maxSessions,
        `Fix this issue and report_result when done.\nFile: ${issue.file}\nSeverity: ${issue.severity}\nIssue: ${issue.description}`,
        `Branch Hunt fix for ${issue.id}`,
        { worktree: opts?.worktree, runtime: opts?.runtime }
      )
      if (spawnResult.error) {
        issue.resolution =
          typeof spawnResult.error === 'string' ? spawnResult.error : 'spawn failed'
        continue
      }
      issue.sessionId = spawnResult.session_id as string

      if (opts?.wait && issue.sessionId) {
        const waited = await waitForSession(
          sessions,
          this.inbox,
          issue.sessionId,
          opts.timeoutMs ?? 120_000
        )
        issue.resolved = waited.status === 'completed'
        issue.resolution = waited.result || waited.status
      }
    }
    return this.issues
  }

  async collectResults(
    sessions?: Map<string, ChildSession>
  ): Promise<
    Array<{ issue_id: string; session_id?: string; resolved: boolean; resolution: string }>
  > {
    const results: Array<{
      issue_id: string
      session_id?: string
      resolved: boolean
      resolution: string
    }> = []

    for (const issue of this.issues) {
      if (!issue.sessionId) {
        results.push({
          issue_id: issue.id,
          resolved: issue.resolved,
          resolution: issue.resolution || 'no session spawned',
        })
        continue
      }

      const msgs = this.inbox.poll(issue.sessionId)
      const done = msgs.find(
        (m) => m.status === 'completed' || m.status === 'failed' || m.status === 'timeout'
      )
      const session = sessions?.get(issue.sessionId)

      if (done) {
        const ok = done.status === 'completed'
        issue.resolved = ok
        const summary = done.payload?.summary
        issue.resolution =
          (typeof summary === 'string' ? summary : '') ||
          session?.stdout.slice(0, 200) ||
          done.status
      } else if (session && (session.status === 'completed' || session.status === 'failed')) {
        issue.resolved = session.status === 'completed'
        issue.resolution = session.stdout.slice(0, 200) || session.status
      }

      results.push({
        issue_id: issue.id,
        session_id: issue.sessionId,
        resolved: issue.resolved,
        resolution: issue.resolution || 'pending',
      })
    }

    return results
  }

  summary(): string {
    const total = this.issues.length
    const resolved = this.issues.filter((i) => i.resolved).length
    const withSession = this.issues.filter((i) => i.sessionId).length
    return `Branch Hunt: ${total} issues, ${withSession} sessions, ${resolved} resolved`
  }
}

export function createBranchHunt(inbox: MessageInbox): BranchHunt {
  return new BranchHunt(inbox)
}
