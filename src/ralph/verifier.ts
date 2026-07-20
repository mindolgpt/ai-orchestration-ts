import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'

const execFileAsync = promisify(execFile)

export type VerifyStep = 'build' | 'lint' | 'test' | 'custom'

export interface VerifierOptions {
  projectRoot: string
  timeoutMs?: number
  /** Default: from AIO_VERIFY_STEPS or build,lint,test */
  steps?: VerifyStep[]
  customCommand?: string
  customArgs?: string[]
}

export interface VerifyReport {
  ok: boolean
  build: boolean
  lint: boolean
  tests: boolean
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
    .filter((s): s is VerifyStep => s === 'build' || s === 'lint' || s === 'test' || s === 'custom')
}

export class Verifier {
  private timeoutMs: number
  private steps: VerifyStep[]
  private scripts: Set<string> | null = null
  private customCommand?: string
  private customArgs: string[]

  constructor(private options: VerifierOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.steps = options.steps || parseStepsEnv() || (['build', 'lint', 'test'] as VerifyStep[])
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

  async verifyBuild(): Promise<boolean> {
    return (await this.runNpm('build')).ok
  }

  async verifyLint(): Promise<boolean> {
    return (await this.runNpm('lint')).ok
  }

  async verifyTests(): Promise<boolean> {
    return (await this.runNpm('test')).ok
  }

  /** Sequential verify ladder per configured steps. */
  async verifyAll(): Promise<VerifyReport> {
    const parts: string[] = []
    const steps_run: string[] = []
    const report: VerifyReport = {
      ok: true,
      build: true,
      lint: true,
      tests: true,
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
      } else if (step === 'test') {
        const r = await this.runNpm('test')
        report.tests = r.ok
        if (!r.ok) {
          report.ok = false
          report.detail = `test: ${r.detail}`
          return report
        }
        parts.push(r.skipped ? 'test skipped' : 'test ok')
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
