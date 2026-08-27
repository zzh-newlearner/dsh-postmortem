import { describe, expect, it } from 'vitest'
import { diagnose, formatReport } from '../src/diagnose.js'
import { argumentFingerprint } from '../src/fingerprint.js'
import { buildRepairPrompt } from '../src/repair.js'

describe('diagnose', () => {
  it('reports a failing tool and failed turn', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, sourceSeq: 3, ended: true, endReason: 'error', toolCalls: [
      { callId: 'call-1', name: 'bash', step: 1, isError: true, errorCode: 'ENOENT', resultPresent: true },
    ] })
    expect(report.decision).toBe('detected')
    expect(report.findings.map(item => item.code)).toEqual(expect.arrayContaining(['tool_error', 'turn_failed']))
    expect(formatReport(report)).toContain('Tool bash failed')
  })

  it('does not flag a completed healthy turn', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, sourceSeq: 2, ended: true, endReason: 'completed', toolCalls: [
      { callId: 'call-1', name: 'read_file', step: 1, isError: false, resultPresent: true },
    ] })
    expect(report.decision).toBe('clean')
  })

  it('finds unchanged repeated failures', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, sourceSeq: 4, ended: true, endReason: 'error', toolCalls: [
      { callId: '1', name: 'bash', step: 1, argumentFingerprint: argumentFingerprint('{"cmd":"bad"}'), isError: true, resultPresent: true },
      { callId: '2', name: 'bash', step: 2, argumentFingerprint: argumentFingerprint('{"cmd":"bad"}'), isError: true, resultPresent: true },
      { callId: '3', name: 'bash', step: 3, argumentFingerprint: argumentFingerprint('{"cmd":"bad"}'), isError: true, resultPresent: true },
    ] })
    expect(report.findings.some(item => item.code === 'retry_loop')).toBe(true)
  })

  it('does not recommend repair for an explicit user cancellation', () => {
    const report = diagnose({
      sessionId: 's1', turn: 1, sourceSeq: 3, ended: true, endReason: 'aborted', endAbortCause: 'user',
      toolCalls: [{ callId: 'call-1', name: 'bash', step: 1, isError: true, errorCode: 'ABORTED', resultPresent: true }],
    })
    expect(report.decision).toBe('cancelled')
    expect(report.findings).toEqual([])
    expect(formatReport(report)).toContain('cancelled by the user')
  })

  it('uses a bounded recovery recommendation for known public error codes', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, sourceSeq: 1, ended: true, endReason: 'error', endErrorCode: 'RATE_LIMIT', toolCalls: [] })
    expect(report.findings[0]?.recommendation).toContain('reduce request pressure')
  })

  it('reports a scheduled model retry without treating it as a terminal repair', () => {
    const report = diagnose({
      sessionId: 's1', turn: 1, sourceSeq: 8, ended: false, toolCalls: [],
      pendingModelRetry: { step: 2, retry: 1, delayMs: 500, mode: 'normal', maxRetries: 5, errorCode: 'RATE_LIMIT', eventSeq: 8 },
    })
    expect(report.decision).toBe('detected')
    expect(report.findings).toMatchObject([{ code: 'model_retry', severity: 'warning', step: 2 }])
    expect(formatReport(report)).toContain('Model request retry 1 is scheduled')
    expect(buildRepairPrompt(report)).toBeUndefined()
  })

  it('warns when a provider is configured to retry indefinitely', () => {
    const report = diagnose({
      sessionId: 's1', turn: 1, sourceSeq: 8, ended: false, toolCalls: [],
      pendingModelRetry: { step: 2, retry: 4, delayMs: 10_000, mode: 'always', eventSeq: 8 },
    })
    expect(report.findings[0]?.recommendation).toContain('retry indefinitely')
  })
})
