import { describe, expect, it } from 'vitest'
import { turnFromEvents } from '../src/adapter.js'

describe('turnFromEvents', () => {
  it('matches tool calls to outcomes in one turn', () => {
    const trace = turnFromEvents('session-1', 2, [
      { type: 'tool/call', data: { turn: 2, step: 1, callId: 'a', name: 'bash', arguments: '{"command":"bad"}' } },
      { type: 'tool/result', data: { turn: 2, step: 1, message: { source: { kind: 'tool', callId: 'a' }, content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'failed' }] }] }, error: { code: 'ENOENT' } } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'error' } } },
    ])
    expect(trace.toolCalls[0]).toMatchObject({ name: 'bash', isError: true, errorCode: 'ENOENT' })
    expect(trace.toolCalls[0]?.argumentFingerprint).toMatch(/^sha256:/)
    expect(JSON.stringify(trace)).not.toContain('"command":"bad"')
    expect(trace.endReason).toBe('error')
  })

  it('preserves the completed turn reason used by DSH', () => {
    const trace = turnFromEvents('session-1', 1, [
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    expect(trace.endReason).toBe('completed')
  })

  it('keeps the latest DSH turn error code without retaining its message', () => {
    const trace = turnFromEvents('session-1', 3, [
      { type: 'turn/end', seq: 8, data: { turn: 3, reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'private detail' } } } },
    ])
    expect(trace.endErrorCode).toBe('MISSING_CREDENTIAL')
  })

  it('normalizes equivalent JSON arguments and retains user cancellation cause', () => {
    const trace = turnFromEvents('session-1', 4, [
      { type: 'tool/call', data: { turn: 4, step: 1, callId: 'first', name: 'shell', arguments: '{"a":1,"b":2}' } },
      { type: 'tool/call', data: { turn: 4, step: 2, callId: 'second', name: 'shell', arguments: '{"b":2,"a":1}' } },
      { type: 'turn/end', data: { turn: 4, reason: { kind: 'aborted', reason: { kind: 'user' } } } },
    ])
    expect(trace.toolCalls[0]?.argumentFingerprint).toBe(trace.toolCalls[1]?.argumentFingerprint)
    expect(trace.endAbortCause).toBe('user')
  })
})
