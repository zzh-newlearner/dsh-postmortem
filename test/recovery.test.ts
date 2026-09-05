import { describe, expect, it } from 'vitest'
import { buildRecoveryHandoff } from '../src/recovery.js'
import { repairPlanFingerprint } from '../src/repair.js'
import type { PostmortemReport } from '../src/types.js'

function report(): PostmortemReport {
  return {
    schemaVersion: '2', sessionId: 'failed-session', turn: 3, sourceSeq: 12,
    decision: 'detected', modelState: 'disabled',
    findings: [{
      code: 'tool_error', severity: 'error', step: 1, title: 'Tool cat failed',
      eventSeqs: [4, 5], evidence: ['tool=cat', 'call=opaque', 'error_code=ENOENT'],
      recommendation: 'Check that the requested executable or resource exists before retrying this action.',
    }],
  }
}

describe('buildRecoveryHandoff', () => {
  it('creates a redacted fresh-attempt packet with a stable repair-plan identity', () => {
    const handoff = buildRecoveryHandoff(report())
    expect(handoff).toMatchObject({
      schemaVersion: '1', sourceSessionId: 'failed-session', sourceTurn: 3, sourceSeq: 12,
    })
    expect(handoff?.repairPlanFingerprint).toMatch(/^sha256:/)
    expect(handoff?.prompt).toContain('fresh agent attempt')
    expect(handoff?.prompt).not.toContain('opaque')
    expect(handoff?.repairPlanFingerprint).toBe(repairPlanFingerprint({
      schemaVersion: '1', sessionId: 'failed-session', turn: 3, sourceSeq: 12,
      actions: [{
        id: 'repair-1', findingCode: 'tool_error', step: 1, kind: 'check_resource', execution: 'copy_only',
        action: 'Check that the requested executable or resource exists, then update the reference before one new call.',
        verification: 'Confirm the resource is available before issuing a changed call.',
      }],
    }))
  })

  it('refuses clean and non-actionable reports', () => {
    expect(buildRecoveryHandoff({ ...report(), decision: 'clean', findings: [] })).toBeUndefined()
  })
})
