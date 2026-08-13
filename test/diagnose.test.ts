import { describe, expect, it } from 'vitest'
import { diagnose, formatReport } from '../src/diagnose.js'

describe('diagnose', () => {
  it('reports a failing tool and failed turn', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, ended: true, endReason: 'error', toolCalls: [
      { callId: 'call-1', name: 'bash', isError: true, errorCode: 'ENOENT', result: 'not found' },
    ] })
    expect(report.decision).toBe('detected')
    expect(report.findings.map(item => item.code)).toEqual(expect.arrayContaining(['tool_error', 'turn_failed']))
    expect(formatReport(report)).toContain('Tool bash failed')
  })

  it('does not flag a completed healthy turn', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, ended: true, endReason: 'completed', toolCalls: [
      { callId: 'call-1', name: 'read_file', isError: false, result: 'ok' },
    ] })
    expect(report.decision).toBe('clean')
  })

  it('finds unchanged repeated failures', () => {
    const report = diagnose({ sessionId: 's1', turn: 1, ended: true, endReason: 'error', toolCalls: [
      { callId: '1', name: 'bash', arguments: '{"cmd":"bad"}', isError: true, result: 'bad' },
      { callId: '2', name: 'bash', arguments: '{"cmd":"bad"}', isError: true, result: 'bad' },
      { callId: '3', name: 'bash', arguments: '{"cmd":"bad"}', isError: true, result: 'bad' },
    ] })
    expect(report.findings.some(item => item.code === 'retry_loop')).toBe(true)
  })
})
