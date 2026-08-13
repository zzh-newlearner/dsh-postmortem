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
    expect(trace.endReason).toBe('error')
  })

  it('preserves the completed turn reason used by DSH', () => {
    const trace = turnFromEvents('session-1', 1, [
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    expect(trace.endReason).toBe('completed')
  })
})
