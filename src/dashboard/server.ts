import * as fs from 'fs/promises'
import * as path from 'path'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { createEmbedder } from '@/knowledge/embedder'
import { lintWiki } from '@/knowledge/wiki-ops'
import {
  listWikiProposals,
  applyWikiProposal,
  rejectWikiProposal,
  type WikiProposal,
} from '@/knowledge/wiki-mr'
import { listVaultEntries, loadVaultRegistry } from '@/knowledge/vault-registry'
import { rawInboxDir, ensureRawInbox, scanRawInbox } from '@/knowledge/raw-inbox'
import { resolveIndexDir, resolveProjectRoot } from '@/knowledge/paths'
import { getEventLog, type OrchestratorEvent } from '@/observability/events'
import { runDoctor } from '@/doctor/check'
import {
  resolveDashboardAuthRequirement,
  assertDashboardAuthorized,
  assertDashboardMutationAllowed,
} from '@/security/dashboard-auth'
import { readLimitedJsonBody } from '@/security/http-auth'

const TEXT_EXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html', '.htm'])

export interface DashboardProposalSummary {
  id: string
  title: string
  wiki_path: string
  status: WikiProposal['status']
  created_at: string
  rationale?: string
  diff_preview: string[]
}

export interface DashboardStats {
  project_root: string
  vault_root: string
  generated_at: string
  active_vault: {
    env_name: string | null
    registry_default: string
    path: string
    switch_hint: string
  }
  wiki: {
    ok: boolean
    total_pages: number
    raw_count: number
    orphan_count: number
    index_percent: number
    issue_count: number
    issues: string[]
  }
  search_index: {
    document_count: number | null
  }
  proposals: {
    pending: number
    applied: number
    rejected: number
    pending_list: DashboardProposalSummary[]
  }
  raw_inbox: {
    pending_files: number
    pending_names: string[]
    failed_files: number
    failed_names: string[]
  }
  doctor: {
    ok: boolean
    fail: number
    warn: number
    package_version: string
    checks: Array<{ id: string; severity: string; message: string }>
    next_steps: string[]
  }
  vaults: Array<{ name: string; path: string; domain?: string; is_active: boolean }>
  recent_events: OrchestratorEvent[]
  commands: {
    scan_inbox: string
    wiki_lint: string
    doctor: string
    watch_raw: string
  }
}

async function listTextFiles(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir)
    const out: string[] = []
    for (const n of names) {
      if (n.startsWith('.') || n === 'processed' || n === 'failed') continue
      const abs = path.join(dir, n)
      try {
        const st = await fs.stat(abs)
        if (st.isFile() && TEXT_EXT.has(path.extname(n).toLowerCase())) {
          out.push(n)
        }
      } catch {
        /* skip */
      }
    }
    return out.sort()
  } catch {
    return []
  }
}

function summarizeProposal(p: WikiProposal): DashboardProposalSummary {
  return {
    id: p.id,
    title: p.title,
    wiki_path: p.wiki_path,
    status: p.status,
    created_at: p.created_at,
    rationale: p.rationale,
    diff_preview: p.diff_lines.slice(0, 12),
  }
}

const statsInflight = new Map<string, Promise<DashboardStats>>()

export async function collectDashboardStats(
  vault: ObsidianVault,
  projectRoot?: string,
  search?: SemanticSearch,
  opts?: { quick?: boolean }
): Promise<DashboardStats> {
  const root = projectRoot || resolveProjectRoot()
  const key = `${path.resolve(root)}::${path.resolve(vault.rootPath)}`
  const existing = statsInflight.get(key)
  if (existing) return existing

  const promise = (async (): Promise<DashboardStats> => {
    const lint = await lintWiki(vault, { deep: false })
    const proposals = opts?.quick ? [] : await listWikiProposals(root)
    const vaults = await listVaultEntries(root)
    const registry = await loadVaultRegistry(root)

    await ensureRawInbox(vault.rootPath)
    const pendingNames = await listTextFiles(rawInboxDir(vault.rootPath))
    const failedNames = opts?.quick
      ? []
      : await listTextFiles(path.join(vault.rootPath, 'raw-inbox', 'failed'))

    const events = opts?.quick ? [] : await getEventLog(root).recentAsync(40)

    const doctor = opts?.quick
      ? null
      : await runDoctor({
          projectRoot: root,
          vault: vault.rootPath,
          skipEmbedTest: true,
          quick: true,
        })

    const envName = process.env.AIO_VAULT_NAME?.trim() || null
    const activeName = envName || registry.default
    const pendingList = proposals.filter((p) => p.status === 'pending').map(summarizeProposal)

    let documentCount: number | null = null
    if (search) {
      try {
        await search.load()
        documentCount = search.documentCount
      } catch {
        documentCount = null
      }
    }

    return {
      project_root: root,
      vault_root: vault.rootPath,
      generated_at: new Date().toISOString(),
      active_vault: {
        env_name: envName,
        registry_default: registry.default,
        path: vault.rootPath,
        switch_hint:
          'Set AIO_VAULT_NAME in MCP env and restart the MCP server to switch vaults (register_vault only updates yaml).',
      },
      wiki: {
        ok: lint.ok,
        total_pages: lint.total_wiki_pages,
        raw_count: lint.raw_count,
        orphan_count: lint.orphan_count,
        index_percent: lint.index_percent,
        issue_count: lint.issues.length,
        issues: lint.issues.slice(0, 20),
      },
      search_index: { document_count: documentCount },
      proposals: {
        pending: pendingList.length,
        applied: proposals.filter((p) => p.status === 'applied').length,
        rejected: proposals.filter((p) => p.status === 'rejected').length,
        pending_list: pendingList.slice(0, 20),
      },
      raw_inbox: {
        pending_files: pendingNames.length,
        pending_names: pendingNames.slice(0, 20),
        failed_files: failedNames.length,
        failed_names: failedNames.slice(0, 20),
      },
      doctor: doctor
        ? {
            ok: doctor.ok,
            fail: doctor.checks.filter((c) => c.severity === 'fail').length,
            warn: doctor.checks.filter((c) => c.severity === 'warn').length,
            package_version: doctor.package_version,
            checks: doctor.checks
              .filter((c) => c.severity !== 'ok')
              .slice(0, 15)
              .map((c) => ({ id: c.id, severity: c.severity, message: c.message })),
            next_steps: doctor.next_steps.slice(0, 6),
          }
        : { ok: true, fail: 0, warn: 0, package_version: 'unknown', checks: [], next_steps: [] },
      vaults: vaults.map((v) => ({
        name: v.name,
        path: v.path,
        domain: v.domain,
        is_active: v.name === activeName || path.resolve(v.path) === path.resolve(vault.rootPath),
      })),
      recent_events: events,
      commands: {
        scan_inbox: 'aio scan-inbox',
        wiki_lint: 'aio wiki-lint --deep --fail',
        doctor: 'aio doctor --skip-embed-test',
        watch_raw: 'aio watch-raw',
      },
    }
  })()

  statsInflight.set(key, promise)
  try {
    return await promise
  } finally {
    statsInflight.delete(key)
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function dashboardHtml(stats: DashboardStats): string {
  const eventRows = stats.recent_events
    .slice()
    .reverse()
    .map(
      (e) =>
        `<tr class="lvl-${esc(e.level || 'info')}"><td>${new Date(e.ts).toLocaleString()}</td><td>${esc(
          e.type
        )}</td><td>${esc(e.message || JSON.stringify(e.data || {}).slice(0, 100))}</td></tr>`
    )
    .join('')

  const vaultRows = stats.vaults
    .map(
      (v) =>
        `<tr class="${v.is_active ? 'active-row' : ''}"><td>${esc(v.name)}${
          v.is_active ? ' <span class="pill">active</span>' : ''
        }</td><td>${esc(v.path)}</td><td>${esc(v.domain || '-')}</td></tr>`
    )
    .join('')

  const issueRows =
    stats.wiki.issues.map((i) => `<li>${esc(i)}</li>`).join('') ||
    '<li class="muted">No lint issues</li>'

  const doctorRows =
    stats.doctor.checks
      .map(
        (c) =>
          `<li class="${esc(c.severity)}">[${esc(c.severity)}] ${esc(c.id)} — ${esc(c.message)}</li>`
      )
      .join('') || '<li class="muted">Doctor checks look good</li>'

  const pendingCards = stats.proposals.pending_list
    .map((p) => {
      const diff = p.diff_preview.map((l) => esc(l)).join('\n')
      return `<article class="proposal" data-id="${esc(p.id)}">
  <header>
    <strong>${esc(p.title)}</strong>
    <code>${esc(p.id)}</code>
  </header>
  <p class="muted">${esc(p.wiki_path)} · ${esc(p.created_at)}</p>
  ${p.rationale ? `<p>${esc(p.rationale)}</p>` : ''}
  <pre class="diff">${diff || '(no diff preview)'}</pre>
  <div class="actions">
    <button type="button" class="btn ok" data-action="apply" data-id="${esc(p.id)}">Apply</button>
    <button type="button" class="btn warn" data-action="reject" data-id="${esc(p.id)}">Reject</button>
  </div>
</article>`
    })
    .join('')

  const inboxPending =
    stats.raw_inbox.pending_names.map((n) => `<li>${esc(n)}</li>`).join('') ||
    '<li class="muted">Empty</li>'
  const inboxFailed =
    stats.raw_inbox.failed_names.map((n) => `<li class="fail">${esc(n)}</li>`).join('') ||
    '<li class="muted">None</li>'

  const cmd = stats.commands

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>aio dashboard</title>
  <style>
    :root { --bg:#0f1419; --card:#161b22; --border:#30363d; --text:#e7ecf3; --muted:#8b949e; --ok:#3fb950; --warn:#d29922; --fail:#f85149; --link:#58a6ff; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 1.5rem; background: var(--bg); color: var(--text); }
    h1 { font-size: 1.35rem; margin: 0 0 0.25rem; }
    h2 { font-size: 1rem; margin: 0 0 0.75rem; }
    .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.25rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 0.85rem; }
    .card h3 { margin: 0 0 0.35rem; font-size: 0.7rem; text-transform: uppercase; color: var(--muted); letter-spacing: .04em; }
    .card .val { font-size: 1.5rem; font-weight: 650; }
    .ok { color: var(--ok); } .warn { color: var(--warn); } .fail { color: var(--fail); }
    .muted { color: var(--muted); }
    section { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); }
    a { color: var(--link); }
    ul { margin: 0; padding-left: 1.1rem; }
    li { margin: 0.25rem 0; font-size: 0.85rem; }
    .pill { display: inline-block; font-size: 0.65rem; padding: 0.1rem 0.4rem; border-radius: 999px; background: #238636; color: #fff; }
    .active-row td { background: rgba(63,185,80,.08); }
    .proposal { border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.75rem; }
    .proposal header { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
    .diff { background: #0d1117; border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem; max-height: 140px; overflow: auto; font-size: 0.75rem; white-space: pre-wrap; }
    .actions { display: flex; gap: 0.5rem; margin-top: 0.6rem; flex-wrap: wrap; }
    .btn, .cmd { border: 1px solid var(--border); background: #21262d; color: var(--text); border-radius: 6px; padding: 0.35rem 0.7rem; font-size: 0.8rem; cursor: pointer; }
    .btn.ok { border-color: #238636; } .btn.warn { border-color: #9e6a03; }
    .cmd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .toast { position: fixed; right: 1rem; bottom: 1rem; background: #21262d; border: 1px solid var(--border); padding: 0.75rem 1rem; border-radius: 8px; display: none; max-width: 360px; z-index: 20; }
    .toast.show { display: block; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
    tr.lvl-error td { color: var(--fail); } tr.lvl-warn td { color: var(--warn); }
  </style>
</head>
<body>
  <h1>aio dashboard</h1>
  <p class="meta">${esc(stats.project_root)} · vault: ${esc(stats.vault_root)} · ${esc(stats.generated_at)}</p>
  <p class="meta">Active vault: <strong>${esc(stats.active_vault.env_name || stats.active_vault.registry_default)}</strong>
    (env=${esc(stats.active_vault.env_name || '—')}, default=${esc(stats.active_vault.registry_default)})
    · ${esc(stats.active_vault.switch_hint)}</p>

  <div class="grid">
    <div class="card"><h3>Wiki health</h3><div class="val ${stats.wiki.ok ? 'ok' : 'warn'}">${stats.wiki.ok ? 'OK' : 'ISSUES'}</div></div>
    <div class="card"><h3>Wiki pages</h3><div class="val">${stats.wiki.total_pages}</div></div>
    <div class="card"><h3>Raw sources</h3><div class="val">${stats.wiki.raw_count}</div></div>
    <div class="card"><h3>Index coverage</h3><div class="val">${stats.wiki.index_percent}%</div></div>
    <div class="card"><h3>Search docs</h3><div class="val">${stats.search_index.document_count ?? '—'}</div></div>
    <div class="card"><h3>Pending MR</h3><div class="val">${stats.proposals.pending}</div></div>
    <div class="card"><h3>Raw inbox</h3><div class="val">${stats.raw_inbox.pending_files}</div></div>
    <div class="card"><h3>Inbox failed</h3><div class="val ${stats.raw_inbox.failed_files ? 'fail' : ''}">${stats.raw_inbox.failed_files}</div></div>
    <div class="card"><h3>Doctor</h3><div class="val ${stats.doctor.ok ? 'ok' : 'fail'}">${stats.doctor.ok ? 'OK' : 'FAIL'}</div></div>
  </div>

  <section>
    <h2>Quick actions</h2>
    <div class="actions">
      <button type="button" class="btn" id="btn-scan">Scan raw inbox</button>
      <button type="button" class="btn" id="btn-refresh">Refresh</button>
      <button type="button" class="cmd" data-copy="${esc(cmd.scan_inbox)}">${esc(cmd.scan_inbox)}</button>
      <button type="button" class="cmd" data-copy="${esc(cmd.wiki_lint)}">${esc(cmd.wiki_lint)}</button>
      <button type="button" class="cmd" data-copy="${esc(cmd.doctor)}">${esc(cmd.doctor)}</button>
      <button type="button" class="cmd" data-copy="${esc(cmd.watch_raw)}">${esc(cmd.watch_raw)}</button>
    </div>
  </section>

  <div class="cols">
    <section>
      <h2>Wiki lint issues (${stats.wiki.issue_count})</h2>
      <ul>${issueRows}</ul>
    </section>
    <section>
      <h2>Doctor (@${esc(stats.doctor.package_version)}) — fail ${stats.doctor.fail} / warn ${stats.doctor.warn}</h2>
      <ul>${doctorRows}</ul>
      ${
        stats.doctor.next_steps.length
          ? `<p class="muted">Next: ${stats.doctor.next_steps.map(esc).join(' · ')}</p>`
          : ''
      }
    </section>
  </div>

  <section>
    <h2>Pending wiki proposals</h2>
    ${pendingCards || '<p class="muted">No pending proposals</p>'}
  </section>

  <div class="cols">
    <section>
      <h2>Raw inbox pending</h2>
      <ul>${inboxPending}</ul>
    </section>
    <section>
      <h2>Raw inbox failed</h2>
      <ul>${inboxFailed}</ul>
    </section>
  </div>

  <section>
    <h2>Vaults</h2>
    <table><thead><tr><th>Name</th><th>Path</th><th>Domain</th></tr></thead><tbody>${vaultRows}</tbody></table>
  </section>

  <section>
    <h2>Recent events</h2>
    <table><thead><tr><th>Time</th><th>Type</th><th>Detail</th></tr></thead><tbody>${
      eventRows || '<tr><td colspan="3">No events</td></tr>'
    }</tbody></table>
  </section>

  <p class="meta">API: <a href="/api/stats">/api/stats</a> · <a href="/api/events">/api/events</a> · Auto-refresh 30s · Local actions only</p>
  <div class="toast" id="toast"></div>
  <script>
    const toast = (msg, isErr) => {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.borderColor = isErr ? '#f85149' : '#30363d';
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 3500);
    };
    const post = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    };
    document.getElementById('btn-refresh').onclick = () => location.reload();
    document.getElementById('btn-scan').onclick = async () => {
      try {
        const r = await post('/api/scan-inbox');
        toast('Scanned: ' + (r.processed?.length || 0) + ' file(s)');
        setTimeout(() => location.reload(), 600);
      } catch (e) { toast(String(e.message || e), true); }
    };
    document.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.getAttribute('data-copy'));
          toast('Copied command');
        } catch { toast('Copy failed', true); }
      });
    });
    document.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        try {
          if (action === 'apply') {
            await post('/api/proposals/' + encodeURIComponent(id) + '/apply');
            toast('Applied ' + id);
          } else {
            const reason = prompt('Reject reason (optional)') || undefined;
            await post('/api/proposals/' + encodeURIComponent(id) + '/reject', { reason });
            toast('Rejected ' + id);
          }
          setTimeout(() => location.reload(), 500);
        } catch (e) { toast(String(e.message || e), true); }
      });
    });
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data, null, 2))
}

export interface DashboardServerOptions {
  host?: string
  port?: number
  vault: ObsidianVault
  search?: SemanticSearch
  projectRoot?: string
}

export async function startDashboardServer(opts: DashboardServerOptions): Promise<{
  url: string
  close: () => Promise<void>
}> {
  const host = opts.host || '127.0.0.1'
  const port = opts.port || 8920
  const projectRoot = opts.projectRoot || resolveProjectRoot()
  const { token, requireAuth } = resolveDashboardAuthRequirement(host)
  await opts.vault.initialize()

  const search =
    opts.search ?? new SemanticSearch(createEmbedder(), resolveIndexDir(opts.vault.rootPath))
  if (!opts.search) {
    await search.load()
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const urlPath = req.url?.split('?')[0] || '/'
      const method = (req.method || 'GET').toUpperCase()
      const url = new URL(req.url || '/', `http://${req.headers.host || host}`)

      try {
        if (method === 'GET' && urlPath === '/health') {
          sendJson(res, 200, { ok: true })
          return
        }

        if (requireAuth) {
          assertDashboardAuthorized(req, url, token, true)
        }

        if (method === 'GET' && (urlPath === '/api/stats' || urlPath === '/api/dashboard')) {
          sendJson(res, 200, await collectDashboardStats(opts.vault, projectRoot, search))
          return
        }

        if (method === 'GET' && urlPath === '/api/events') {
          const events = await getEventLog(projectRoot).recentAsync(100)
          sendJson(res, 200, { events })
          return
        }

        if (method === 'POST') {
          assertDashboardMutationAllowed(req, url, token, requireAuth)

          if (urlPath === '/api/scan-inbox') {
            const result = await scanRawInbox(opts.vault, search, {
              project_root: projectRoot,
              subdir: 'domain',
              run_lint: true,
            })
            await getEventLog(projectRoot).emit('dashboard.scan_inbox', {
              processed: result.processed.length,
            })
            sendJson(res, 200, result)
            return
          }

          const applyMatch = urlPath.match(/^\/api\/proposals\/([^/]+)\/apply$/)
          if (applyMatch) {
            const id = decodeURIComponent(applyMatch[1])
            const result = await applyWikiProposal(
              opts.vault,
              search,
              { id, resolver: 'dashboard' },
              projectRoot
            )
            sendJson(res, 200, result)
            return
          }

          const rejectMatch = urlPath.match(/^\/api\/proposals\/([^/]+)\/reject$/)
          if (rejectMatch) {
            const id = decodeURIComponent(rejectMatch[1])
            const body = await readLimitedJsonBody(req)
            const reason = typeof body.reason === 'string' ? body.reason : undefined
            const result = await rejectWikiProposal(
              id,
              { resolver: 'dashboard', reason },
              projectRoot
            )
            sendJson(res, 200, { proposal: result })
            return
          }

          sendJson(res, 404, { error: `Unknown POST route: ${urlPath}` })
          return
        }

        if (method === 'GET' && urlPath === '/') {
          const stats = await collectDashboardStats(opts.vault, projectRoot, search)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(dashboardHtml(stats))
          return
        }

        sendJson(res, 404, { error: 'Not Found' })
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode || 500
        sendJson(res, status, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve())
    server.on('error', reject)
  })

  const addr = `http://${host}:${port}`
  await getEventLog(projectRoot).emit('dashboard.start', { url: addr })

  return {
    url: addr,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
