/** One arm of a runner-neutral paired intervention experiment. */
export interface PairedRunRecord {
  schemaVersion: '1'
  pairId: string
  taskId: string
  arm: 'baseline' | 'postmortem'
  success: boolean
  /** Identifies the same task setup without retaining its private content. */
  taskFingerprint: string
  toolCalls: number
  elapsedMs?: number
}

export interface PairIssue {
  pairId: string
  reason: string
}

export interface PairedEvaluation {
  eligiblePairs: number
  excludedPairs: number
  baselineSuccessRate: number | undefined
  postmortemSuccessRate: number | undefined
  successRateDelta: number | undefined
  pairedWins: number
  pairedLosses: number
  ties: number
  issues: PairIssue[]
}

/**
 * Compare only matched baseline/postmortem attempts. This intentionally does
 * not declare causality or a release gate: callers must pre-register tasks and
 * keep model, tool, and task setup equal between arms.
 */
export function evaluatePairs(records: readonly PairedRunRecord[]): PairedEvaluation {
  const grouped = new Map<string, PairedRunRecord[]>()
  for (const record of records) {
    const values = grouped.get(record.pairId) ?? []
    values.push(record)
    grouped.set(record.pairId, values)
  }
  const issues: PairIssue[] = []
  const valid: Array<{ baseline: PairedRunRecord, postmortem: PairedRunRecord }> = []
  for (const [pairId, entries] of grouped) {
    const baseline = entries.filter(entry => entry.arm === 'baseline')
    const postmortem = entries.filter(entry => entry.arm === 'postmortem')
    if (baseline.length !== 1 || postmortem.length !== 1) {
      issues.push({ pairId, reason: 'expected exactly one baseline and one postmortem record' })
      continue
    }
    const left = baseline[0]
    const right = postmortem[0]
    if (left === undefined || right === undefined) continue
    if (left.taskId !== right.taskId || left.taskFingerprint !== right.taskFingerprint) {
      issues.push({ pairId, reason: 'task identity or task fingerprint differs between arms' })
      continue
    }
    valid.push({ baseline: left, postmortem: right })
  }
  const count = valid.length
  const baselineSuccesses = valid.filter(pair => pair.baseline.success).length
  const postmortemSuccesses = valid.filter(pair => pair.postmortem.success).length
  return {
    eligiblePairs: count,
    excludedPairs: issues.length,
    baselineSuccessRate: count === 0 ? undefined : baselineSuccesses / count,
    postmortemSuccessRate: count === 0 ? undefined : postmortemSuccesses / count,
    successRateDelta: count === 0 ? undefined : (postmortemSuccesses - baselineSuccesses) / count,
    pairedWins: valid.filter(pair => !pair.baseline.success && pair.postmortem.success).length,
    pairedLosses: valid.filter(pair => pair.baseline.success && !pair.postmortem.success).length,
    ties: valid.filter(pair => pair.baseline.success === pair.postmortem.success).length,
    issues,
  }
}
