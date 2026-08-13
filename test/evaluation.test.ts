import { describe, expect, it } from 'vitest'
import { evaluatePairs, type PairedRunRecord } from '../src/evaluation.js'

const record = (pairId: string, arm: PairedRunRecord['arm'], success: boolean): PairedRunRecord => ({
  schemaVersion: '1', pairId, taskId: 'task-1', arm, success, taskFingerprint: 'sha256:fixed', toolCalls: 3,
})

describe('paired evaluation', () => {
  it('calculates success uplift only from matched pairs', () => {
    const result = evaluatePairs([record('a', 'baseline', false), record('a', 'postmortem', true), record('b', 'baseline', true), record('b', 'postmortem', true)])
    expect(result).toMatchObject({ eligiblePairs: 2, baselineSuccessRate: 0.5, postmortemSuccessRate: 1, successRateDelta: 0.5, pairedWins: 1, pairedLosses: 0, ties: 1 })
  })

  it('excludes mismatched or incomplete pairs', () => {
    const mismatched = { ...record('bad', 'postmortem', true), taskFingerprint: 'sha256:other' }
    const result = evaluatePairs([record('bad', 'baseline', false), mismatched, record('missing', 'baseline', false)])
    expect(result).toMatchObject({ eligiblePairs: 0, excludedPairs: 2, successRateDelta: undefined })
  })
})
