import type { PendingModelRetry, RecordedEvent, ToolCall, TurnTrace } from './types.js'
import { argumentFingerprint, retryFingerprint } from './fingerprint.js'

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function nonEmptyStringValue(value: unknown): string | undefined {
  const text = stringValue(value)
  return text !== undefined && text.trim() !== '' ? text : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

interface ToolMetadata {
  name?: string
  argumentsValue?: unknown
  step?: number
}

const UNKNOWN_TOOL_NAME = 'unknown tool'

function assistantMessageToolMetadata(event: RecordedEvent): Array<[string, ToolMetadata]> {
  const message = objectValue(event.data.message)
  const content = Array.isArray(message?.content) ? message?.content : event.data.content
  if (!Array.isArray(content)) return []
  const step = numberValue(event.data.step)
  const values: Array<[string, ToolMetadata]> = []
  for (const item of content) {
    const block = objectValue(item)
    if (block?.type !== 'tool-call') continue
    const callId = nonEmptyStringValue(block.id)
    if (callId === undefined) continue
    values.push([callId, {
      ...(nonEmptyStringValue(block.name) === undefined ? {} : { name: nonEmptyStringValue(block.name) }),
      ...(block.arguments === undefined ? {} : { argumentsValue: block.arguments }),
      ...(step === undefined ? {} : { step }),
    }])
  }
  return values
}

function callKey(callId: string | undefined, event: RecordedEvent, index: number): string {
  return callId === undefined ? `unkeyed:${event.seq ?? 'none'}:${index}` : `id:${callId}`
}

function unknownCall(step: number): ToolCall {
  return { step, callPresent: false, resultPresent: false, isError: false }
}

function commandToolName(argumentsValue: unknown): string | undefined {
  let parsed = argumentsValue
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return undefined
    }
  }
  const argumentsObject = objectValue(parsed)
  const command = stringValue(argumentsObject?.command)
  if (command === undefined) return undefined
  const token = command.trim().split(/\s+/, 1)[0]
  if (token === undefined) return undefined
  const basename = token.replace(/\\/g, '/').split('/').at(-1)
  return basename !== undefined && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,47}$/.test(basename)
    ? basename
    : undefined
}

function displayToolName(name: string | undefined, argumentsValue: unknown): string {
  return name ?? commandToolName(argumentsValue) ?? UNKNOWN_TOOL_NAME
}

function dequeue(keysByStep: Map<number, string[]>, step: number): string | undefined {
  if (step === 0) return undefined
  const keys = keysByStep.get(step)
  const key = keys?.shift()
  if (keys?.length === 0) keysByStep.delete(step)
  return key
}

/** Project only diagnosis metadata from a DSH event log. Tool payloads stay in the log. */
export function turnFromEvents(sessionId: string, turn: number, events: readonly RecordedEvent[]): TurnTrace {
  const calls = new Map<string, ToolCall>()
  const assistantCalls = new Map<string, ToolMetadata>()
  const pendingEmptyCallsByStep = new Map<number, string[]>()
  const pendingEmptyResultsByStep = new Map<number, string[]>()
  // Session exports can be reordered by an external headless collector. Index
  // canonical assistant tool blocks first so call/result pairing stays stable.
  for (const event of events) {
    if (numberValue(event.data.turn) !== turn || event.type !== 'assistant/message') continue
    for (const [callId, metadata] of assistantMessageToolMetadata(event)) assistantCalls.set(callId, metadata)
  }
  let endReason: string | undefined
  let endErrorCode: string | undefined
  let endAbortCause: string | undefined
  let endEventSeq: number | undefined
  let pendingModelRetry: PendingModelRetry | undefined
  let sourceSeq = 0
  let recognizedEventCount = 0
  let unknownTurnEventCount = 0
  let malformedEventCount = 0
  for (const [index, event] of events.entries()) {
    const eventTurn = numberValue(event.data.turn)
    if (eventTurn !== turn) continue
    sourceSeq = Math.max(sourceSeq, event.seq ?? 0)
    if (!['turn/start', 'assistant/message', 'tool/call', 'tool/result', 'turn/end', 'llm/retry', 'llm/retry-started'].includes(event.type)) {
      unknownTurnEventCount += 1
      continue
    }
    recognizedEventCount += 1
    if (event.type === 'tool/call') {
      const callId = nonEmptyStringValue(event.data.callId)
      const metadata = callId === undefined ? undefined : assistantCalls.get(callId)
      const explicitName = nonEmptyStringValue(event.data.name) ?? metadata?.name
      const argumentsValue = event.data.arguments ?? metadata?.argumentsValue
      const step = numberValue(event.data.step) ?? metadata?.step ?? 0
      if (step === 0) malformedEventCount += 1
      const key = callId === undefined
        ? dequeue(pendingEmptyResultsByStep, step) ?? callKey(callId, event, index)
        : callKey(callId, event, index)
      const current = calls.get(key) ?? unknownCall(step)
      calls.set(key, {
        ...current,
        ...(callId === undefined ? {} : { callId }),
        name: current.name ?? displayToolName(explicitName, argumentsValue),
        ...(argumentsValue === undefined ? {} : {
          argumentFingerprint: argumentFingerprint(argumentsValue),
          retryFingerprint: retryFingerprint(argumentsValue),
        }),
        step: current.step === 0 ? step : current.step,
        callPresent: true,
        ...(event.seq === undefined ? {} : { callEventSeq: event.seq }),
      })
      if (callId === undefined && !current.resultPresent && step > 0) {
        const values = pendingEmptyCallsByStep.get(step) ?? []
        values.push(key)
        pendingEmptyCallsByStep.set(step, values)
      }
    }
    if (event.type === 'tool/result') {
      const message = objectValue(event.data.message)
      const source = objectValue(message?.source)
      const content = Array.isArray(message?.content) ? message.content : undefined
      const resultBlock = content?.map(objectValue).find(block => block?.type === 'tool-result')
      const callId = nonEmptyStringValue(source?.callId) ?? nonEmptyStringValue(event.data.callId)
      const metadata = callId === undefined ? undefined : assistantCalls.get(callId)
      const step = numberValue(event.data.step) ?? metadata?.step ?? 0
      if (step === 0) malformedEventCount += 1
      const key = callId === undefined
        ? dequeue(pendingEmptyCallsByStep, step) ?? callKey(callId, event, index)
        : callKey(callId, event, index)
      const current = calls.get(key) ?? unknownCall(step)
      const error = objectValue(event.data.error)
      calls.set(key, {
        ...current,
        ...(callId === undefined ? {} : { callId }),
        ...(current.name === undefined ? { name: displayToolName(metadata?.name, metadata?.argumentsValue) } : {}),
        ...(current.argumentFingerprint === undefined && metadata?.argumentsValue !== undefined ? {
          argumentFingerprint: argumentFingerprint(metadata.argumentsValue),
          retryFingerprint: retryFingerprint(metadata.argumentsValue),
        } : {}),
        step: current.step === 0 ? step : current.step,
        resultPresent: true,
        ...(event.seq === undefined ? {} : { resultEventSeq: event.seq }),
        isError: resultBlock?.isError === true || event.data.isError === true,
        ...(nonEmptyStringValue(error?.code) === undefined ? {} : { errorCode: nonEmptyStringValue(error?.code) }),
      })
      if (callId === undefined && !current.callPresent && step > 0) {
        const values = pendingEmptyResultsByStep.get(step) ?? []
        values.push(key)
        pendingEmptyResultsByStep.set(step, values)
      }
    }
    if (event.type === 'turn/end') {
      const reason = objectValue(event.data.reason)
      const kind = stringValue(reason?.kind)
      if (kind === undefined) malformedEventCount += 1
      else {
        endReason = kind
        endErrorCode = stringValue(objectValue(reason?.error)?.code)
        endAbortCause = stringValue(objectValue(reason?.reason)?.kind)
        endEventSeq = event.seq
      }
    }
    if (event.type === 'llm/retry') {
      const step = numberValue(event.data.step)
      const retry = numberValue(event.data.retry)
      const delayMs = numberValue(event.data.delayMs)
      const mode = stringValue(event.data.mode)
      const maxRetries = numberValue(event.data.maxRetries)
      const failure = objectValue(event.data.failure)
      if (step !== undefined && retry !== undefined && retry > 0 && delayMs !== undefined
        && (mode === 'normal' || mode === 'always')) {
        const errorCode = stringValue(failure?.code)
        pendingModelRetry = {
          step,
          retry,
          delayMs,
          mode,
          ...(maxRetries === undefined ? {} : { maxRetries }),
          ...(errorCode === undefined ? {} : { errorCode }),
          ...(event.seq === undefined ? {} : { eventSeq: event.seq }),
        }
      } else malformedEventCount += 1
    }
    if (event.type === 'llm/retry-started' && pendingModelRetry !== undefined) {
      const step = numberValue(event.data.step)
      const retry = numberValue(event.data.retry)
      if (step === pendingModelRetry.step && retry === pendingModelRetry.retry) pendingModelRetry = undefined
    }
  }
  return {
    sessionId,
    turn,
    ended: endReason !== undefined,
    endReason,
    endErrorCode,
    endAbortCause,
    endEventSeq,
    sourceSeq,
    toolCalls: [...calls.values()].sort((left, right) => left.step - right.step || (left.callId ?? '').localeCompare(right.callId ?? '')),
    ...(endReason === undefined && pendingModelRetry !== undefined ? { pendingModelRetry } : {}),
    recognizedEventCount,
    unknownTurnEventCount,
    malformedEventCount,
  }
}
