import type { Finding, ModelState, PostmortemReport, ToolCall, TurnTrace } from './types.js'

const RETRY_THRESHOLD = 3

function toolSummary(call: ToolCall): string {
  return `tool=${call.name ?? 'unknown tool'}, call=${call.callId ?? 'unavailable'}`
}

function eventSeqs(...values: Array<number | undefined>): number[] {
  return values.filter((value): value is number => value !== undefined)
}

function userCancelled(trace: TurnTrace): boolean {
  return trace.endReason === 'aborted' && trace.endAbortCause === 'user'
}

function cancellationError(code: string | undefined): boolean {
  if (code === undefined) return false
  const normalized = code.toUpperCase()
  return normalized.includes('ABORT') || normalized.includes('CANCEL')
}

function toolRecommendation(code: string | undefined): string {
  switch (code) {
    case 'TOOL_OUTCOME_UNKNOWN':
      return 'Verify external state before retrying; retry only when the operation is known to be idempotent.'
    case 'TOOL_NOT_STARTED':
      return 'The call did not start. Check that its preconditions still hold before issuing one new call.'
    case 'EACCES':
    case 'EPERM':
      return 'Check the required permission or approval before retrying this action.'
    case 'ENOENT':
      return 'Check that the requested executable or resource exists before retrying this action.'
    default:
      return 'Check the tool documentation and error code, then retry only with a changed input or precondition.'
  }
}

function terminalRecommendation(reason: string, code: string | undefined): string {
  if (reason === 'max-tokens') return 'Resume with a shorter plan or summarize completed work before continuing.'
  switch (code) {
    case 'MISSING_CREDENTIAL':
    case 'INVALID_CREDENTIAL':
      return 'Correct the provider credential configuration before retrying the task.'
    case 'RATE_LIMIT':
      return 'Wait for the provider limit or reduce request pressure before retrying.'
    case 'EMPTY_RESPONSE':
      return 'Retry only after checking the provider response policy and the available token budget.'
    default:
      return 'Use the earlier tool findings as the first recovery target; do not treat the terminal state as a root cause.'
  }
}

export function diagnose(trace: TurnTrace, modelState: ModelState = 'disabled'): PostmortemReport {
  const findings: Finding[] = []
  const cancelled = userCancelled(trace)
  const incompatible = ((trace.unknownTurnEventCount ?? 0) > 0 && (trace.recognizedEventCount ?? 0) === 0)
    || (trace.malformedEventCount ?? 0) > 0
  if (incompatible) {
    findings.push({
      code: 'compat_mismatch', severity: 'error', step: 1,
      title: 'Session event format is incompatible with this plugin version',
      eventSeqs: [],
      evidence: [
        `recognized_turn_events=${trace.recognizedEventCount ?? 0}`,
        `unknown_turn_events=${trace.unknownTurnEventCount ?? 0}`,
        `malformed_events=${trace.malformedEventCount ?? 0}`,
      ],
      recommendation: 'Verify the DSH and plugin compatibility versions before relying on this diagnosis.',
    })
  }
  if (!trace.ended && trace.pendingModelRetry !== undefined) {
    const retry = trace.pendingModelRetry
    const recommendation = retry.mode === 'always'
      ? 'This provider is configured to retry indefinitely; cancel the run if continued attempts are not appropriate.'
      : `Wait for the scheduled retry or cancel the run; this is retry ${retry.retry} of ${retry.maxRetries ?? 'an unknown budget'}.`
    findings.push({
      code: 'model_retry', severity: 'warning', step: retry.step,
      title: `Model request retry ${retry.retry} is scheduled`,
      eventSeqs: eventSeqs(retry.eventSeq),
      evidence: [
        `retry_mode=${retry.mode}`,
        `retry_delay_ms=${retry.delayMs}`,
        ...(retry.maxRetries === undefined ? [] : [`retry_max=${retry.maxRetries}`]),
        ...(retry.errorCode === undefined ? [] : [`model_error_code=${retry.errorCode}`]),
      ],
      recommendation,
    })
  }
  for (const call of trace.toolCalls) {
    if (call.isError && !(cancelled && cancellationError(call.errorCode))) {
      findings.push({
        code: 'tool_error', severity: 'error', step: call.step,
        title: `Tool ${call.name ?? 'unknown tool'} failed`, eventSeqs: eventSeqs(call.callEventSeq, call.resultEventSeq),
        evidence: [toolSummary(call), ...(call.errorCode ? [`error_code=${call.errorCode}`] : [])],
        recommendation: toolRecommendation(call.errorCode),
      })
    }
    if (trace.ended && call.callPresent !== false && !call.resultPresent && !cancelled) {
      findings.push({
        code: 'missing_result', severity: 'warning', step: call.step,
        title: `Tool ${call.name ?? 'unknown tool'} has no recorded result`, eventSeqs: eventSeqs(call.callEventSeq),
        evidence: [toolSummary(call)],
        recommendation: 'Verify whether the tool timed out, was cancelled, or failed before it could return.',
      })
    }
  }

  const runs = new Map<string, ToolCall[]>()
  for (const call of trace.toolCalls) {
    const retryKey = call.retryFingerprint ?? call.argumentFingerprint
    if (call.callPresent === false || call.name === undefined || call.name === 'unknown tool' || retryKey === undefined) continue
    const key = `${call.name}\u0000${retryKey}`
    const values = runs.get(key) ?? []
    values.push(call)
    runs.set(key, values)
  }
  for (const calls of runs.values()) {
    if (!cancelled && calls.length >= RETRY_THRESHOLD && calls.every(call => call.isError || (trace.ended && !call.resultPresent))) {
      const first = calls[0]
      if (first === undefined) continue
      findings.push({
        code: 'retry_loop', severity: 'error', step: first.step,
        title: `Repeated failing call to ${first.name ?? 'unknown tool'}`,
        eventSeqs: calls.flatMap(call => eventSeqs(call.callEventSeq, call.resultEventSeq)),
        evidence: [`same_call_count=${calls.length}`, `tool=${first.name ?? 'unknown tool'}`],
        recommendation: 'Stop repeating the unchanged call; inspect its preconditions or choose another recovery path.',
      })
    }
  }

  if (trace.endReason !== undefined && trace.endReason !== 'completed' && !cancelled) {
    findings.push({
      code: 'turn_failed', severity: 'error', step: Math.max(1, ...trace.toolCalls.map(call => call.step)),
      title: `Turn ended with ${trace.endReason}`, eventSeqs: eventSeqs(trace.endEventSeq),
      evidence: [`turn_end_reason=${trace.endReason}`, ...(trace.endErrorCode === undefined ? [] : [`turn_error_code=${trace.endErrorCode}`])],
      recommendation: terminalRecommendation(trace.endReason, trace.endErrorCode),
    })
  }

  findings.sort((left, right) => left.step - right.step || left.code.localeCompare(right.code))
  return {
    schemaVersion: '2', sessionId: trace.sessionId, turn: trace.turn, sourceSeq: trace.sourceSeq,
    decision: findings.length > 0 ? 'detected' : cancelled ? 'cancelled' : trace.ended ? 'clean' : 'inconclusive',
    ...(findings.length === 0 && !cancelled && !trace.ended
      ? { inconclusiveReason: (trace.recognizedEventCount ?? 0) > 0 ? 'open_turn' as const : 'no_turn_events' as const }
      : {}),
    findings,
    modelState: findings.length > 0 ? modelState : 'skipped_clean',
  }
}

export function formatReport(report: PostmortemReport): string {
  if (report.decision === 'clean') return `Postmortem: turn ${report.turn} has no recorded failures.`
  if (report.decision === 'cancelled') return `Postmortem: turn ${report.turn} was cancelled by the user; no repair is recommended.`
  if (report.decision === 'inconclusive') {
    return report.inconclusiveReason === 'no_turn_events'
      ? `Postmortem: turn ${report.turn} has no recognized session events. Check the selected turn and DSH/plugin compatibility.`
      : `Postmortem [open turn]: turn ${report.turn} is still running and has no terminal diagnosis yet.`
  }
  const lines = [`Postmortem${report.findings.some(finding => finding.code === 'model_retry') ? ' [open turn]' : ' [ended turn]'}: ${report.findings.length} finding(s) in turn ${report.turn}.`]
  const visible = report.findings.slice(0, 4)
  for (const finding of visible) {
    lines.push(`- [${finding.severity}] step ${finding.step}: ${finding.title}. ${finding.recommendation}`)
  }
  const omitted = report.findings.length - visible.length
  if (omitted > 0) lines.push(`... ${omitted} more finding(s) omitted; run /postmortem-export ${report.turn} for all findings.`)
  if (report.modelReview !== undefined) {
    lines.push(`Model review [${report.modelReview.confidence}]: ${report.modelReview.summary}`)
    lines.push(`Immediate action: ${report.modelReview.immediateAction}`)
  } else if (report.modelState === 'pending') {
    lines.push('Model review is running; deterministic findings remain available.')
  } else if (report.modelState === 'failed') {
    lines.push('Model review was unavailable; deterministic findings remain authoritative.')
  }
  lines.push(`Next: /postmortem-next ${report.turn} for one recommended action, /postmortem-repair ${report.turn} for a fresh-attempt prompt, /postmortem-plan ${report.turn} for JSON actions, or /postmortem-export ${report.turn} for the full report.`)
  return lines.join('\n')
}
