import type { RecordedEvent } from '../src/types.js'

interface Fixture {
  name: string
  turn: number
  events: RecordedEvent[]
  decision: 'detected' | 'clean' | 'inconclusive'
  codes: string[]
}

function call(turn: number, step: number, callId: string, name = 'shell', argumentsText = '{"cmd":"x"}'): RecordedEvent {
  return { type: 'tool/call', seq: step * 10, data: { turn, step, callId, name, arguments: argumentsText } }
}

function result(turn: number, step: number, callId: string, isError: boolean, code?: string): RecordedEvent {
  return {
    type: 'tool/result', seq: step * 10 + 1,
    data: {
      turn, step,
      message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', isError }] },
      ...(code === undefined ? {} : { error: { name: 'ToolError', code } }),
    },
  }
}

function end(turn: number, kind: string, seq = 99): RecordedEvent {
  return { type: 'turn/end', seq, data: { turn, reason: { kind } } }
}

export const dshFixtures: Fixture[] = [
  { name: 'completed-empty', turn: 1, events: [end(1, 'completed')], decision: 'clean', codes: [] },
  { name: 'open-turn', turn: 1, events: [call(1, 1, 'a')], decision: 'inconclusive', codes: [] },
  { name: 'tool-error', turn: 1, events: [call(1, 1, 'a'), result(1, 1, 'a', true, 'ENOENT'), end(1, 'error')], decision: 'detected', codes: ['tool_error', 'turn_failed'] },
  { name: 'missing-result', turn: 1, events: [call(1, 1, 'a'), end(1, 'aborted')], decision: 'detected', codes: ['missing_result', 'turn_failed'] },
  { name: 'retry-loop', turn: 1, events: [call(1, 1, 'a'), result(1, 1, 'a', true), call(1, 2, 'b'), result(1, 2, 'b', true), call(1, 3, 'c'), result(1, 3, 'c', true), end(1, 'error')], decision: 'detected', codes: ['retry_loop'] },
  { name: 'error-without-tool', turn: 1, events: [end(1, 'error')], decision: 'detected', codes: ['turn_failed'] },
  { name: 'aborted-turn', turn: 1, events: [end(1, 'aborted')], decision: 'detected', codes: ['turn_failed'] },
  { name: 'max-tokens-turn', turn: 1, events: [end(1, 'max-tokens')], decision: 'detected', codes: ['turn_failed'] },
  { name: 'successful-tool', turn: 1, events: [call(1, 1, 'a'), result(1, 1, 'a', false), end(1, 'completed')], decision: 'clean', codes: [] },
  { name: 'duplicate-successes', turn: 1, events: [call(1, 1, 'a'), result(1, 1, 'a', false), call(1, 2, 'b'), result(1, 2, 'b', false), call(1, 3, 'c'), result(1, 3, 'c', false), end(1, 'completed')], decision: 'clean', codes: [] },
  { name: 'error-code-preserved', turn: 1, events: [call(1, 1, 'a', 'http'), result(1, 1, 'a', true, 'RATE_LIMIT'), end(1, 'error')], decision: 'detected', codes: ['tool_error'] },
  { name: 'multiple-tools', turn: 1, events: [call(1, 1, 'a', 'read'), result(1, 1, 'a', false), call(1, 2, 'b', 'write'), result(1, 2, 'b', true, 'EACCES'), end(1, 'error')], decision: 'detected', codes: ['tool_error', 'turn_failed'] },
]
