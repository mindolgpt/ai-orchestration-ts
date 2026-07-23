import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'

const execFileAsync = promisify(execFile)

export type VerifyStep = 'build' | 'lint' | 'test' | 'typecheck' | 'acceptance' | 'custom'

export interface VerifierOptions {
  projectRoot: string
  timeoutMs?: number
  steps?: VerifyStep[]
  customCommand?: string
  customArgs?: string[]
}

export interface VerifyReport {
  ok: boolean
  build: boolean
  lint: boolean
  tests: boolean
  typecheck: boolean
  acceptance: boolean
  custom: boolean
  detail: string
  steps_run: string[]
}

function parseStepsEnv(): VerifyStep[] | undefined {
  const raw = process.env.AIO_VERIFY_STEPS
  if (!raw?.trim()) return undefined
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(
      (s): s is VerifyStep =>
        s === 'build' ||
        s === 'lint' ||
        s === 'test' ||
        s === 'typecheck' ||
        s === 'acceptance' ||
        s === 'custom'
    )
}

export class Verifier {
  private timeoutMs: number
  private steps: VerifyStep[]
  private scripts: Set<string> | null = null
  private customCommand?: string
  private customArgs: string[]

  constructor(private options: VerifierOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.steps =
      options.steps ||
      parseStepsEnv() ||
      (['build', 'lint', 'typecheck', 'test', 'acceptance'] as VerifyStep[])
    this.customCommand = options.customCommand || process.env.AIO_VERIFY_CUSTOM_CMD
    this.customArgs = options.customArgs || []
    if (process.env.AIO_VERIFY_CUSTOM_ARGS) {
      try {
        const parsed = JSON.parse(process.env.AIO_VERIFY_CUSTOM_ARGS) as string[]
        if (Array.isArray(parsed)) this.customArgs = parsed
      } catch {
        /* ignore */
      }
    }
  }

  private async loadScripts(): Promise<Set<string>> {
    if (this.scripts) return this.scripts
    try {
      const raw = await fs.readFile(path.join(this.options.projectRoot, 'package.json'), 'utf-8')
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
      this.scripts = new Set(Object.keys(pkg.scripts || {}))
    } catch {
      this.scripts = new Set()
    }
    return this.scripts
  }

  private async runNpm(
    script: string
  ): Promise<{ ok: boolean; detail: string; skipped?: boolean }> {
    const scripts = await this.loadScripts()
    if (!scripts.has(script)) {
      return { ok: true, detail: `script '${script}' not defined — skipped`, skipped: true }
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['--silent', 'run', script],
        {
          cwd: this.options.projectRoot,
          timeout: this.timeoutMs,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        }
      )
      return { ok: true, detail: (stdout || stderr || 'ok').slice(-1500) }
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string }
      return {
        ok: false,
        detail: (e.stderr || e.stdout || e.message || 'failed').slice(-1500),
      }
    }
  }

  private async runCustom(): Promise<{ ok: boolean; detail: string; skipped?: boolean }> {
    if (!this.customCommand) {
      return { ok: true, detail: 'no custom command — skipped', skipped: true }
    }
    try {
      const { stdout, stderr } = await execFileAsync(this.customCommand, this.customArgs, {
        cwd: this.options.projectRoot,
        timeout: this.timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        shell: true,
      })
      return { ok: true, detail: (stdout || stderr || 'ok').slice(-1500) }
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string }
      return {
        ok: false,
        detail: (e.stderr || e.stdout || e.message || 'failed').slice(-1500),
      }
    }
  }

  async verifyAcceptance(): Promise<{ ok: boolean; detail: string; skipped?: boolean }> {
    const sddRoot = path.join(this.options.projectRoot, '.aio', 'sdd')
    let files: string[] = []
    try {
      const entries = await fs.readdir(sddRoot, { withFileTypes: true })
      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        const candidate = path.join(sddRoot, ent.name, 'acceptance.json')
        try {
          await fs.access(candidate)
          files.push(candidate)
        } catch {
          /* skip */
        }
      }
    } catch {
      return { ok: true, detail: 'no acceptance.json — skipped', skipped: true }
    }
    if (!files.length) {
      return { ok: true, detail: 'no acceptance.json — skipped', skipped: true }
    }
    // Prefer newest by mtime
    files = (await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(f)).mtimeMs }))))
      .sort((a, b) => b.t - a.t)
      .map((x) => x.f)

    const raw = await fs.readFile(files[0], 'utf-8')
    const data = JSON.parse(raw) as {
      items?: Array<{ id: string; description: string; status: string }>
    }
    const items = data.items || []
    if (!items.length) {
      return { ok: true, detail: 'acceptance empty — skipped', skipped: true }
    }
    const pending = items.filter((i) => i.status !== 'pass')
    if (pending.length) {
      return {
        ok: false,
        detail: `acceptance unmet: ${pending
          .slice(0, 8)
          .map((p) => p.id)
          .join(', ')}`,
      }
    }
    return { ok: true, detail: `acceptance ${items.length} items pass` }
  }

  async verifyBuild(): Promise<boolean> {
    return (await this.runNpm('build')).ok
  }

  async verifyLint(): Promise<boolean> {
    return (await this.runNpm('lint')).ok
  }

  async verifyTests(): Promise<boolean> {
    return (await this.runNpm('test')).ok
  }

  async verifyAll(): Promise<VerifyReport> {
    const parts: string[] = []
    const steps_run: string[] = []
    const report: VerifyReport = {
      ok: true,
      build: true,
      lint: true,
      tests: true,
      typecheck: true,
      acceptance: true,
      custom: true,
      detail: '',
      steps_run,
    }

    for (const step of this.steps) {
      steps_run.push(step)
      if (step === 'build') {
        const r = await this.runNpm('build')
        report.build = r.ok
        if (!r.ok) {
          report.ok = false
          report.detail = `build: ${r.detail}`
          return report
        }
        parts.push(r.skipped ? 'build skipped' : 'build ok')
      } else if (step === 'lint') {
        const r = await this.runNpm('lint')
        report.lint = r.ok
        if (!r.ok) {
          report.ok = false
          report.detail = `lint: ${r.detail}`
          return report
        }
        parts.push(r.skipped ? 'lint skipped' : 'lint ok')
      } else if (step === 'typecheck') {
        const r = await this.runNpm('typecheck')
        report.typecheck = r.ok
        if (!r.ok) {
          report.ok = false
          report.detail = `typecheck: ${r.detail}`
          return report
        }
        parts.push(r.skipped ? 'typecheck skipped' : 'typecheck ok')
      } else if (step === 'test') {
        const r = await this.runNpm('test')
        report.tests = r.ok
        if (!r.ok) {
          report.ok = false
          report.detail = `test: ${r.detail}`
          return report
        }
        parts.push(r.skipped ? 'test skipped' : 'test ok')
      } else if (step === 'acceptance') {
        const r = await this.verifyAcceptance()
        report.acceptance = r.ok
        if (!r.ok) {
          report.ok = false
          report.detail = `acceptance: ${r.detail}`
          return report
        }
        parts.push(r.skipped ? 'acceptance skipped' : 'acceptance ok')
      } else if (step === 'custom') {
        const r = await this.runCustom()
        report.custom = r.ok
        if (!r.ok) {
          report.ok = false
          report.detail = `custom: ${r.detail}`
          return report
        }
        parts.push(r.skipped ? 'custom skipped' : 'custom ok')
      }
    }

    report.detail = parts.join('; ') || 'no steps'
    return report
  }
}

export function createVerifier(
  projectRoot: string,
  opts?: Omit<VerifierOptions, 'projectRoot'>
): Verifier {
  return new Verifier({ projectRoot, ...opts })
}
