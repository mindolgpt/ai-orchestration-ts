import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { sanitizeWikiSubdir, slugifyTitle } from '@/knowledge/wiki-schema'
import { ingestSource } from '@/knowledge/wiki-ops'
import { resolveProjectRoot, toPosixPath } from '@/knowledge/paths'
import { getEventLog } from '@/observability/events'

export type WikiProposalStatus = 'pending' | 'applied' | 'rejected'

export interface WikiProposal {
  id: string
  title: string
  wiki_path: string
  status: WikiProposalStatus
  rationale?: string
  proposed_content: string
  previous_content: string | null
  diff_lines: string[]
  created_at: string
  resolved_at?: string
  resolver?: string
}

function proposalsDir(projectRoot?: string): string {
  return path.join(projectRoot || resolveProjectRoot(), '.aio', 'wiki-proposals')
}

function assertSafeProposalId(id: string): string {
  if (!id || !/^[\w.-]+$/.test(id) || id.includes('..')) {
    throw new Error(`Invalid proposal id: ${id}`)
  }
  return id
}

function assertWikiPath(wikiPath: string): string {
  const p = toPosixPath(wikiPath).replace(/\.md$/, '')
  if (!p.startsWith('wiki/') || p.split('/').includes('..') || path.isAbsolute(p)) {
    throw new Error(`Invalid wiki_path: ${wikiPath}`)
  }
  return p
}

function proposalPath(id: string, projectRoot?: string): string {
  return path.join(proposalsDir(projectRoot), `${assertSafeProposalId(id)}.json`)
}

/**
 * Longest-common-subsequence based diff. Produces minimal add/remove line
 * pairs instead of comparing index-by-index, so an inserted line near the
 * top no longer marks the rest of the document as changed.
 */
function simpleDiff(before: string | null, after: string): string[] {
  const a = (before || '').split('\n')
  const b = after.split('\n')

  // LCS DP table (compact to keep O(n*m) memory bounded for typical wiki
  // pages; the 200-line cap below still protects against pathological sizes).
  const n = a.length
  const m = b.length
  if (n * m > 200_000) {
    // Fall back to the old index comparsion for huge inputs — correctness is
    // preserved (the cap on output lines still applies); just noisy.
    const lines: string[] = []
    for (let i = 0; i < Math.max(n, m); i++) {
      const la = a[i]
      const lb = b[i]
      if (la === lb) continue
      if (la !== undefined) lines.push(`- ${la}`)
      if (lb !== undefined) lines.push(`+ ${lb}`)
    }
    return lines.slice(0, 200)
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const lines: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`- ${a[i]}`)
      i++
    } else {
      lines.push(`+ ${b[j]}`)
      j++
    }
  }
  while (i < n) {
    lines.push(`- ${a[i]}`)
    i++
  }
  while (j < m) {
    lines.push(`+ ${b[j]}`)
    j++
  }
  return lines.slice(0, 200)
}

export async function proposeWikiChange(
  vault: ObsidianVault,
  opts: {
    title: string
    content: string
    rationale?: string
    subdir?: string
  },
  projectRoot?: string
): Promise<WikiProposal> {
  await vault.initialize()
  const slug = slugifyTitle(opts.title)
  const sub = sanitizeWikiSubdir(opts.subdir)
  const wikiPath = assertWikiPath(sub ? `wiki/${sub}/${slug}` : `wiki/${slug}`)
  const previous = await vault.readNote(wikiPath)

  const proposal: WikiProposal = {
    id: `wpr_${randomUUID().slice(0, 8)}`,
    title: opts.title,
    wiki_path: wikiPath,
    status: 'pending',
    rationale: opts.rationale,
    proposed_content: opts.content.trim(),
    previous_content: previous,
    diff_lines: simpleDiff(previous, opts.content.trim()),
    created_at: new Date().toISOString(),
  }

  await fs.mkdir(proposalsDir(projectRoot), { recursive: true })
  await fs.writeFile(
    proposalPath(proposal.id, projectRoot),
    JSON.stringify(proposal, null, 2),
    'utf-8'
  )

  await getEventLog(projectRoot).emit('wiki.proposal.created', {
    id: proposal.id,
    title: opts.title,
    wiki_path: wikiPath,
  })

  return proposal
}

export async function listWikiProposals(
  projectRoot?: string,
  status?: WikiProposalStatus
): Promise<WikiProposal[]> {
  const dir = proposalsDir(projectRoot)
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }

  const out: WikiProposal[] = []
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8')) as WikiProposal
      if (!status || p.status === status) out.push(p)
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function getWikiProposal(
  id: string,
  projectRoot?: string
): Promise<WikiProposal | null> {
  assertSafeProposalId(id)
  try {
    return JSON.parse(await fs.readFile(proposalPath(id, projectRoot), 'utf-8')) as WikiProposal
  } catch {
    return null
  }
}

async function saveProposal(proposal: WikiProposal, projectRoot?: string): Promise<void> {
  await fs.writeFile(
    proposalPath(proposal.id, projectRoot),
    JSON.stringify(proposal, null, 2),
    'utf-8'
  )
}

export async function applyWikiProposal(
  vault: ObsidianVault,
  search: SemanticSearch,
  opts: { id: string; resolver?: string },
  projectRoot?: string
): Promise<{ proposal: WikiProposal; applied: boolean }> {
  const proposal = await getWikiProposal(opts.id, projectRoot)
  if (!proposal) throw new Error(`Proposal not found: ${opts.id}`)
  if (proposal.status !== 'pending') {
    throw new Error(`Proposal ${opts.id} is ${proposal.status}, not pending`)
  }

  const wikiPath = assertWikiPath(proposal.wiki_path)

  if (proposal.previous_content) {
    await vault.initialize()
    const tags = await vault.getTags(wikiPath)
    const nextTags = tags.length ? [...new Set([...tags, 'wiki'])] : ['wiki']
    await vault.writeNote(wikiPath, proposal.proposed_content, nextTags)
    await search.addDocument(wikiPath, proposal.title, proposal.proposed_content, nextTags)
    await search.save()
    const indexSlug = wikiPath.replace(/^wiki\//, '')
    await vault.upsertWikiIndexEntry({
      slug: indexSlug,
      title: proposal.title,
      summary: proposal.rationale || proposal.title,
      tags: nextTags,
    })
  } else {
    const sub = sanitizeWikiSubdir(
      wikiPath.replace(/^wiki\//, '').includes('/')
        ? wikiPath
            .replace(/^wiki\//, '')
            .split('/')
            .slice(0, -1)
            .join('/')
        : undefined
    )
    await ingestSource(vault, search, {
      title: proposal.title,
      content: proposal.proposed_content,
      subdir: sub,
      summary: proposal.rationale,
    })
  }

  proposal.status = 'applied'
  proposal.resolved_at = new Date().toISOString()
  proposal.resolver = opts.resolver || 'human'
  await saveProposal(proposal, projectRoot)

  await vault.appendLog(
    `## [${new Date().toISOString().slice(0, 10)}] wiki_mr apply | ${proposal.title} (${proposal.id})`
  )

  await getEventLog(projectRoot).emit('wiki.proposal.applied', { id: proposal.id })

  return { proposal, applied: true }
}

export async function rejectWikiProposal(
  id: string,
  opts?: { resolver?: string; reason?: string },
  projectRoot?: string
): Promise<WikiProposal> {
  const proposal = await getWikiProposal(id, projectRoot)
  if (!proposal) throw new Error(`Proposal not found: ${id}`)
  if (proposal.status !== 'pending') {
    throw new Error(`Proposal ${id} is ${proposal.status}`)
  }

  proposal.status = 'rejected'
  proposal.resolved_at = new Date().toISOString()
  proposal.resolver = opts?.resolver || 'human'
  if (opts?.reason)
    proposal.rationale = `${proposal.rationale || ''}\nRejected: ${opts.reason}`.trim()
  await saveProposal(proposal, projectRoot)

  await getEventLog(projectRoot).emit('wiki.proposal.rejected', { id })

  return proposal
}

export async function wikiDiff(
  vault: ObsidianVault,
  title: string,
  proposedContent: string,
  subdir?: string
): Promise<{ wiki_path: string; diff_lines: string[]; exists: boolean }> {
  await vault.initialize()
  const slug = slugifyTitle(title)
  const sub = sanitizeWikiSubdir(subdir)
  const wikiPath = assertWikiPath(sub ? `wiki/${sub}/${slug}` : `wiki/${slug}`)
  const previous = await vault.readNote(wikiPath)
  return {
    wiki_path: wikiPath,
    diff_lines: simpleDiff(previous, proposedContent.trim()),
    exists: !!previous,
  }
}
