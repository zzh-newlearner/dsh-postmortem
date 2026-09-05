import { describe, expect, it } from 'vitest'
import { formatNextStep } from '../src/guidance.js'
import type { PostmortemReport } from '../src/types.js'

function detected(overrides: Partial<PostmortemReport> = {}): PostmortemReport {
  return {
    schemaVersion: '2', sessionId: 'session', turn: 4, sourceSeq: 9,
    decision: 'detected', modelState: 'disabled',
    findings: [{
      code: 'tool_error', severity: 'error', step: 1, title: 'Tool cat failed', eventSeqs: [3, 4],
      evidence: ['tool=cat', 'error_code=ENOENT'],
      recommendation: 'Check that the requested executable or resource exists before retrying this action.',
    }],
    ...overrides,
  }
}

describe('formatNextStep', () => {
  it('gives one actionable recovery route when DSH can create an agent', () => {
    const text = formatNextStep(detected(), { recoveryAvailable: true })
    expect(text).toContain('Primary issue: Tool cat failed.')
    expect(text).toContain('Verify first: Confirm the resource is available')
    expect(text).toContain('/postmortem-recover 4')
    expect(text).toContain('project verifier, test command, or checker')
    expect(text).not.toContain('tool=cat')
  })

  it('exports a handoff when no DSH agent runtime is available', () => {
    expect(formatNextStep(detected(), { recoveryAvailable: false })).toContain('/postmortem-handoff 4')
  })

  it('does not suggest a recovery while a provider retry is scheduled', () => {
    const report = detected({
      findings: [{
        code: 'model_retry', severity: 'warning', step: 2, title: 'Model request retry 1 is scheduled', eventSeqs: [4],
        evidence: ['retry_mode=normal'], recommendation: 'Wait for the scheduled retry or cancel the run.',
      }],
    })
    const text = formatNextStep(report, { recoveryAvailable: true })
    expect(text).toContain('Wait: this turn has no repair action')
    expect(text).not.toContain('/postmortem-recover')
  })
})
