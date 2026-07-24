import { DesignEvidence, SddDesign, SddSpec, SddTasks, TechnicalKickoffPacket } from './types'

export interface ReadinessReport {
  score: number
  isReady: boolean
  criticalFindings: string[]
  warnings: string[]
}

export interface SelfReviewResult {
  verdict: 'PASS' | 'PARTIAL' | 'BLOCKED' | 'NEEDS_WORK'
  readiness: 'ready' | 'partial' | 'blocked'
  blockers: string[]
  warnings: string[]
  coverage: Record<string, number>
}

export function validateDesignReadiness(
  design: SddDesign,
  spec: SddSpec | undefined,
  evidence: DesignEvidence[],
  kickoff: TechnicalKickoffPacket | undefined
): ReadinessReport {
  const criticalFindings: string[] = []
  const warnings: string[] = []
  let score = 100

  if (!spec || spec.status !== 'approved') {
    criticalFindings.push('Spec is not approved')
    score -= 30
  }

  // Note: do NOT penalize `design.status !== 'approved'` here. This function
  // gates the approveDesign() *action* — checking the post-approval status
  // would create a chicken-and-egg (impossible to approve). The action itself
  // flips design.status to 'approved' on success, so this gate must rely on
  // upstream signals: spec approval + evidence coverage only.

  const evidenceByCoverage = groupBy(evidence, (e) => e.proof)
  const confirmedCount = (evidenceByCoverage.get('confirmed-path') || []).length
  const partialCount = (evidenceByCoverage.get('partial-path') || []).length

  if (partialCount > 0) {
    warnings.push(`${partialCount} evidence items have partial-path coverage`)
    score -= Math.min(partialCount * 5, 20)
  }

  if (confirmedCount === 0 && evidence.length > 0) {
    criticalFindings.push('No confirmed-path evidence exists')
    score -= 15
  }

  if (kickoff?.technicalOwnerQuestions?.length) {
    warnings.push(`${kickoff.technicalOwnerQuestions.length} unanswered technical questions`)
    score -= 10
  }

  return {
    score: Math.max(0, score),
    isReady: score >= 95 && criticalFindings.length === 0,
    criticalFindings,
    warnings,
  }
}

export function validateTaskReadiness(
  tasks: SddTasks,
  design: SddDesign,
  spec: SddSpec | undefined
): ReadinessReport {
  const criticalFindings: string[] = []
  const warnings: string[] = []
  let score = 100

  if (!spec || spec.status !== 'approved') {
    criticalFindings.push('Spec must be approved for task generation')
    score -= 30
  }

  if (design.status !== 'approved' || !design.approvedRevision) {
    criticalFindings.push('Design must be approved with a valid revision')
    score -= 30
  }

  if (design.approvedRevision && design.designRevision !== design.approvedRevision) {
    criticalFindings.push('Design revision does not match approved revision')
    score -= 25
  }

  if (tasks.executionReadiness !== 'ready') {
    criticalFindings.push(`Task readiness is ${tasks.executionReadiness}, expected 'ready'`)
    score -= 20
  }

  if (tasks.schemaVersion !== 'sdd-tasks.v1') {
    warnings.push(`Unexpected schema version: ${tasks.schemaVersion}`)
    score -= 5
  }

  return {
    score: Math.max(0, score),
    isReady: score >= 95 && criticalFindings.length === 0,
    criticalFindings,
    warnings,
  }
}

export function selfReview(
  evidence: DesignEvidence[],
  kickoff?: TechnicalKickoffPacket
): SelfReviewResult {
  const blockers: string[] = []
  const warnings: string[] = []

  for (const ev of evidence) {
    if (ev.proof === 'candidate' && ['high', 'critical'].includes(ev.finding)) {
      blockers.push(`Candidate evidence with ${ev.finding} risk: ${ev.id}`)
    }
  }

  if (kickoff?.technicalOwnerQuestions?.length) {
    warnings.push(`Open technical questions: ${kickoff.technicalOwnerQuestions.length}`)
  }

  const confirmed = evidence.filter((e) => e.proof === 'confirmed-path').length
  const total = evidence.length
  const coverage = {
    confirmed,
    partial: evidence.filter((e) => e.proof === 'partial-path').length,
    candidate: evidence.filter((e) => e.proof === 'candidate').length,
  }

  const hasBlockers = blockers.length > 0
  const hasOpenTQs = warnings.some((w) => w.includes('Open technical questions'))

  let verdict: SelfReviewResult['verdict'] = 'PASS'
  let readiness: SelfReviewResult['readiness'] = 'ready'

  if (hasBlockers) {
    verdict = 'BLOCKED'
    readiness = 'blocked'
  } else if (coverage.candidate > 0 || hasOpenTQs) {
    verdict = 'PARTIAL'
    readiness = 'partial'
  }

  if (total === 0) {
    verdict = 'NEEDS_WORK'
    readiness = 'blocked'
    blockers.push('No evidence collected')
  }

  return { verdict, readiness, blockers, warnings, coverage }
}

function groupBy<T, K>(items: T[], fn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const key = fn(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return map
}
