import type { RecordedEvent, ToolCall, TurnTrace } from './types.js'

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Project only diagnosis metadata from a DSH event log. Tool payloads stay in the log. */
export function turnFromEvents(sessionId: string, turn: number, events: readonly RecordedEvent[]): TurnTrace {
  const calls = new Map<string, ToolCall>()
  let endReason: string | undefined
  let endEventSeq: number | undefined
  let sourceSeq = 0
  for (const event of events) {
    const eventTurn = numberValue(event.data.turn)
    if (eventTurn !== turn) continue
    sourceSeq = Math.max(sourceSeq, event.seq ?? 0)
    if (event.type === 'tool/call') {
      const callId = stringValue(event.data.callId)
      const name = stringValue(event.data.name)
      const step = numberValue(event.data.step)
      if (callId !== undefined && name !== undefined && step !== undefined) {
        calls.set(callId, {
          callId,
          name,
          arguments: stringValue(event.data.arguments),
          step,
          callEventSeq: event.seq,
          resultPresent: false,
          isError: false,
        })
      }
    }
    if (event.type === 'tool/result') {
      const message = objectValue(event.data.message)
      const source = objectValue(message?.source)
      const content = Array.isArray(message?.content) ? message.content[0] : undefined
      const resultBlock = objectValue(content)
      const callId = stringValue(source?.callId)
      if (callId !== undefined) {
        const current = calls.get(callId)
        if (current !== undefined) {
          const error = objectValue(event.data.error)
          calls.set(callId, {
            ...current,
            resultPresent: true,
            resultEventSeq: event.seq,
            isError: resultBlock?.isError === true,
            errorCode: stringValue(error?.code),
          })
        }
      }
    }
    if (event.type === 'turn/end') {
      const reason = objectValue(event.data.reason)
      endReason = stringValue(reason?.kind) ?? 'unknown'
      endEventSeq = event.seq
    }
  }
  return {
    sessionId,
    turn,
    ended: endReason !== undefined,
    endReason,
    endEventSeq,
    sourceSeq,
    toolCalls: [...calls.values()].sort((left, right) => left.step - right.step || left.callId.localeCompare(right.callId)),
  }
}
