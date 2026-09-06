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

  it('does not turn three distinct structured calls into a retry loop', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, sourceSeq: 8, ended: true, endReason: 'error', toolCalls: [
      { callId: '1', name: 'shell', step: 1, argumentFingerprint: argumentFingerprint({ cmd: 'ls' }), isError: true, resultPresent: true },
      { callId: '2', name: 'shell', step: 2, argumentFingerprint: argumentFingerprint({ cmd: 'rm' }), isError: true, resultPresent: true },
      { callId: '3', name: 'shell', step: 3, argumentFingerprint: argumentFingerprint({ cmd: 'cp' }), isError: true, resultPresent: true },
    ] })
    expect(report.findings.some(item => item.code === 'retry_loop')).toBe(false)
  })

  it('does not group missing fingerprints as unchanged calls', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, sourceSeq: 8, ended: true, endReason: 'error', toolCalls: [
      { callId: '1', name: 'shell', step: 1, isError: true, resultPresent: true },
      { callId: '2', name: 'shell', step: 2, isError: true, resultPresent: true },
      { callId: '3', name: 'shell', step: 3, isError: true, resultPresent: true },
    ] })
    expect(report.findings.some(item => item.code === 'retry_loop')).toBe(false)
  })

  it('reports compatibility mismatch instead of a silent inconclusive result', () => {
    const report = diagnose({
      sessionId: 's1', turn: 1, sourceSeq: 4, ended: false, toolCalls: [],
      recognizedEventCount: 0, unknownTurnEventCount: 4, malformedEventCount: 0,
    })
    expect(report).toMatchObject({ decision: 'detected', findings: [expect.objectContaining({ code: 'compat_mismatch' })] })
    expect(formatReport(report)).toContain('incompatible')
  })

  it('distinguishes an open turn from a turn with no events', () => {
    const open = diagnose({ sessionId: 's1', turn: 1, sourceSeq: 1, ended: false, recognizedEventCount: 1, toolCalls: [] })
    const empty = diagnose({ sessionId: 's1', turn: 2, sourceSeq: 0, ended: false, recognizedEventCount: 0, toolCalls: [] })
    expect(open.inconclusiveReason).toBe('open_turn')
    expect(empty.inconclusiveReason).toBe('no_turn_events')
    expect(formatReport(empty)).toContain('no recognized session events')
  })

  it('discloses truncated findings and the next command', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, sourceSeq: 8, ended: true, endReason: 'error', toolCalls: [
      { callId: '1', name: 'a', step: 1, isError: true, resultPresent: true },
      { callId: '2', name: 'b', step: 2, isError: true, resultPresent: true },
      { callId: '3', name: 'c', step: 3, isError: true, resultPresent: true },
      { callId: '4', name: 'd', step: 4, isError: true, resultPresent: true },
    ] })
    const text = formatReport(report)
    expect(text).toContain('more finding(s) omitted')
    expect(text).toContain('Next: /postmortem-next 1')
    expect(text).toContain('/postmortem-repair 1')
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
