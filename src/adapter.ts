import type { RecordedEvent, ToolCall, TurnTrace } from './types.js'

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function turnFromEvents(sessionId: string, turn: number, events: readonly RecordedEvent[]): TurnTrace {
  const calls = new Map<string, ToolCall>()
  let endReason: string | undefined
  for (const event of events) {
    const eventTurn = event.data.turn
    if (eventTurn !== turn) continue
    if (event.type === 'tool/call') {
      const callId = stringValue(event.data.callId)
      const name = stringValue(event.data.name)
      if (callId !== undefined && name !== undefined) {
        calls.set(callId, { callId, name, arguments: stringValue(event.data.arguments), isError: false })
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
            result: JSON.stringify(message?.content ?? null),
            isError: resultBlock?.isError === true,
            errorCode: stringValue(error?.code),
          })
        }
      }
    }
    if (event.type === 'turn/end') {
      const reason = objectValue(event.data.reason)
      endReason = stringValue(reason?.kind) ?? 'unknown'
    }
  }
  return { sessionId, turn, ended: endReason !== undefined, endReason, toolCalls: [...calls.values()] }
}
