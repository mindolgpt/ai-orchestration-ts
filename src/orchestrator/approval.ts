import * as fs from 'fs/promises'
import * as path from 'path'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { resolveProjectRoot } from '@/knowledge/paths'
import { getEventLog } from '@/observability/events'

export interface ResolveApprovalOptions {
  confirmCode?: string
  /** Local CLI / trusted channel — skips confirm_code check */
  trustedLocal?: boolean
}

export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface ApprovalRequest {
  id: string
  action: string
  reason: string
  risk: ApprovalRisk
  status: ApprovalStatus
  createdAt: number
  resolvedAt?: number
  resolver?: string
  meta?: Record<string, unknown>
  /** sha256 of confirm code — never store plaintext code on disk */
  confirmHash?: string
}

const DANGEROUS_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bforce\s*push\b/i,
  /\bnpm\s+publish\b/i,
  /\brm\s+-rf\b/i,
  /\bdrop\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\bkubectl\s+delete\b/i,
]

export function looksDangerous(text: string): boolean {
  return DANGEROUS_PATTERNS.some((re) => re.test(text))
}

function hashConfirmCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

export class ApprovalGate {
  private items = new Map<string, ApprovalRequest>()
  /** In-memory plaintext codes (also printed to stderr; never returned via MCP JSON). */
  private confirmCodes = new Map<string, string>()
  private filePath: string
  private ttlMs: number

  constructor(projectRoot?: string, ttlMs = 30 * 60_000) {
    const root = projectRoot || resolveProjectRoot()
    this.filePath = path.join(root, '.aio', 'approvals.json')
    this.ttlMs = ttlMs
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const arr = JSON.parse(raw) as ApprovalRequest[]
      this.items.clear()
      for (const a of arr) this.items.set(a.id, a)
    } catch {
      /* fresh */
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(
      this.filePath,
      JSON.stringify(Array.from(this.items.values()), null, 2),
      'utf-8'
    )
  }

  private expireOld(): void {
    const now = Date.now()
    for (const a of this.items.values()) {
      if (a.status === 'pending' && now - a.createdAt > this.ttlMs) {
        a.status = 'expired'
        a.resolvedAt = now
      }
    }
  }

  async request(
    action: string,
    reason: string,
    risk: ApprovalRisk = 'high',
    meta?: Record<string, unknown>
  ): Promise<ApprovalRequest> {
    this.expireOld()
    const confirmCode = randomBytes(8).toString('hex')
    const req: ApprovalRequest = {
      id: `apr_${randomUUID().slice(0, 8)}`,
      action,
      reason,
      risk,
      status: 'pending',
      createdAt: Date.now(),
      meta,
      confirmHash: hashConfirmCode(confirmCode),
    }
    this.items.set(req.id, req)
    this.confirmCodes.set(req.id, confirmCode)
    await this.persist()
    // Human-visible only (MCP clients / models typically do not receive stderr)
    console.error(
      `[aio:approval] id=${req.id} confirm_code=${confirmCode} action=${action} risk=${risk}`
    )
    await getEventLog().emit('approval.requested', { id: req.id, action, risk })
    return req
  }

  private confirmCodeOk(req: ApprovalRequest, confirmCode?: string): boolean {
    if (process.env.AIO_ALLOW_MCP_APPROVAL_RESOLVE === '1') return true
    const code = (confirmCode || '').trim()
    if (!code) return false
    const mem = this.confirmCodes.get(req.id)
    if (mem && mem === code) return true
    if (req.confirmHash && hashConfirmCode(code) === req.confirmHash) return true
    return false
  }

  async resolve(
    id: string,
    approved: boolean,
    resolver = 'human',
    opts?: ResolveApprovalOptions
  ): Promise<ApprovalRequest | { error: string }> {
    this.expireOld()
    const req = this.items.get(id)
    if (!req) return { error: `Approval ${id} not found` }
    if (req.status !== 'pending') return { error: `Approval ${id} is ${req.status}` }

    // Approving via MCP requires confirm_code from server stderr (or trusted CLI / env opt-in).
    // Rejects remain open so a stuck gate can be closed without the code.
    if (approved && !opts?.trustedLocal && !this.confirmCodeOk(req, opts?.confirmCode)) {
      return {
        error:
          'confirm_code required to approve (see MCP server stderr / terminal for [aio:approval]). ' +
          'Or run: aio approval resolve <id> --approve. ' +
          'Automation: set AIO_ALLOW_MCP_APPROVAL_RESOLVE=1.',
      }
    }

    req.status = approved ? 'approved' : 'rejected'
    req.resolvedAt = Date.now()
    req.resolver = resolver
    this.confirmCodes.delete(id)
    delete req.confirmHash
    await this.persist()
    await getEventLog().emit('approval.resolved', {
      id,
      approved,
      resolver,
    })
    return req
  }

  list(status?: ApprovalStatus): ApprovalRequest[] {
    this.expireOld()
    const all = Array.from(this.items.values())
    return status ? all.filter((a) => a.status === status) : all
  }

  get(id: string): ApprovalRequest | undefined {
    this.expireOld()
    return this.items.get(id)
  }

  /** Block until approved/rejected/expired or timeout. */
  async waitFor(id: string, timeoutMs = 300_000): Promise<ApprovalRequest | { error: string }> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      this.expireOld()
      const req = this.items.get(id)
      if (!req) return { error: 'not found' }
      if (req.status !== 'pending') return req
      await new Promise((r) => setTimeout(r, 500))
      // reload from disk so another process/tool can approve
      await this.load()
    }
    return { error: 'timeout waiting for approval' }
  }
}
