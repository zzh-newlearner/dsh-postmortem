import { evaluatePairs, type PairedEvaluation, type PairedRunRecord } from './evaluation.js'

export interface VerifiedPairedRunRecord {
  schemaVersion: '1'
  protocolId: string
  pairId: string
  taskId: string
  arm: 'baseline' | 'postmortem'
  success: boolean
  /** One-way identity of the task fixture, excluding private task content. */
  taskFingerprint: string
  /** One-way identity of model, tools, retry policy, and execution settings. */
  environmentFingerprint: string
  /** One-way identity of the pre-registered success check. */
  successCriterionFingerprint: string
  intervention: 'none' | 'repair_plan'
  /** Required only for the postmortem arm; never store the plan itself in run data. */
  repairPlanFingerprint?: string
  toolCalls: number
  elapsedMs?: number
}

export interface VerifiedPairedEvaluation extends PairedEvaluation {
  verifiedPairs: number
}

const fingerprintPattern = /^sha256:[a-f0-9]{64}$/

function validText(value: string): boolean {
  return value.trim().length > 0
}

function validFingerprint(value: string): boolean {
  return fingerprintPattern.test(value)
}

/** Validate fields required before a record can support a causal success-rate claim. */
export function validateVerifiedPairedRunRecord(record: VerifiedPairedRunRecord): string[] {
  const issues: string[] = []
  if (record.schemaVersion !== '1') issues.push('unsupported verified-pair schema version')
  for (const [name, value] of Object.entries({ protocolId: record.protocolId, pairId: record.pairId, taskId: record.taskId })) {
    if (!validText(value)) issues.push(`${name} is empty`)
  }
  for (const [name, value] of Object.entries({
    taskFingerprint: record.taskFingerprint,
    environmentFingerprint: record.environmentFingerprint,
    successCriterionFingerprint: record.successCriterionFingerprint,
  })) {
    if (!validFingerprint(value)) issues.push(`${name} is not a sha256 fingerprint`)
  }
  if (!Number.isSafeInteger(record.toolCalls) || record.toolCalls < 0) issues.push('toolCalls is invalid')
  if (record.elapsedMs !== undefined && (!Number.isFinite(record.elapsedMs) || record.elapsedMs < 0)) issues.push('elapsedMs is invalid')
  if (record.arm === 'baseline' && (record.intervention !== 'none' || record.repairPlanFingerprint !== undefined)) {
    issues.push('baseline arm must have no repair-plan intervention')
  }
  if (record.arm === 'postmortem' && (record.intervention !== 'repair_plan' || record.repairPlanFingerprint === undefined || !validFingerprint(record.repairPlanFingerprint))) {
    issues.push('postmortem arm requires a repair-plan fingerprint')
  }
  return issues
}

/**
 * Count only pairs with identical pre-registered protocol, task, environment,
 * and success criterion. This remains an analysis helper, not a task runner.
 */
export function evaluateVerifiedPairs(records: readonly VerifiedPairedRunRecord[]): VerifiedPairedEvaluation {
  const groups = new Map<string, VerifiedPairedRunRecord[]>()
  for (const record of records) {
    const entries = groups.get(record.pairId) ?? []
    entries.push(record)
    groups.set(record.pairId, entries)
  }
  const issues: Array<{ pairId: string, reason: string }> = []
  const eligible: PairedRunRecord[] = []
  for (const [pairId, entries] of groups) {
    const baseline = entries.filter(record => record.arm === 'baseline')
    const postmortem = entries.filter(record => record.arm === 'postmortem')
    if (baseline.length !== 1 || postmortem.length !== 1) {
      issues.push({ pairId, reason: 'expected exactly one baseline and one postmortem record' })
      continue
    }
    const left = baseline[0]
    const right = postmortem[0]
    if (left === undefined || right === undefined) continue
    const validation = [...validateVerifiedPairedRunRecord(left), ...validateVerifiedPairedRunRecord(right)]
    if (validation.length > 0) {
      issues.push({ pairId, reason: validation.join('; ') })
      continue
    }
    const mismatch = ['protocolId', 'taskId', 'taskFingerprint', 'environmentFingerprint', 'successCriterionFingerprint']
      .find(field => left[field as keyof VerifiedPairedRunRecord] !== right[field as keyof VerifiedPairedRunRecord])
    if (mismatch !== undefined) {
      issues.push({ pairId, reason: `${mismatch} differs between arms` })
      continue
    }
    eligible.push(
      { schemaVersion: '1', pairId, taskId: left.taskId, arm: 'baseline', success: left.success, taskFingerprint: left.taskFingerprint, toolCalls: left.toolCalls, elapsedMs: left.elapsedMs },
      { schemaVersion: '1', pairId, taskId: right.taskId, arm: 'postmortem', success: right.success, taskFingerprint: right.taskFingerprint, toolCalls: right.toolCalls, elapsedMs: right.elapsedMs },
    )
  }
  const evaluation = evaluatePairs(eligible)
  return { ...evaluation, eligiblePairs: eligible.length / 2, excludedPairs: issues.length, verifiedPairs: eligible.length / 2, issues }
}
