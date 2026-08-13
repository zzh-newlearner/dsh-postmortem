import type { Finding, ModelState, PostmortemReport, ToolCall, TurnTrace } from './types.js'

const RETRY_THRESHOLD = 3

function toolSummary(call: ToolCall): string {
  return `tool=${call.name}, call=${call.callId}`
}

function eventSeqs(...values: Array<number | undefined>): number[] {
  return values.filter((value): value is number => value !== undefined)
}

export function diagnose(trace: TurnTrace, modelState: ModelState = 'disabled'): PostmortemReport {
  const findings: Finding[] = []
  for (const call of trace.toolCalls) {
    if (call.isError) {
      findings.push({
        code: 'tool_error', severity: 'error', step: call.step,
        title: `Tool ${call.name} failed`, eventSeqs: eventSeqs(call.callEventSeq, call.resultEventSeq),
        evidence: [toolSummary(call), ...(call.errorCode ? [`error_code=${call.errorCode}`] : [])],
        recommendation: 'Inspect the tool arguments and error code before retrying this action.',
      })
    }
    if (trace.ended && !call.resultPresent) {
      findings.push({
        code: 'missing_result', severity: 'warning', step: call.step,
        title: `Tool ${call.name} has no recorded result`, eventSeqs: eventSeqs(call.callEventSeq),
        evidence: [toolSummary(call)],
        recommendation: 'Verify whether the tool timed out, was cancelled, or failed before it could return.',
      })
    }
  }

  const runs = new Map<string, ToolCall[]>()
  for (const call of trace.toolCalls) {
    const key = `${call.name}\u0000${call.arguments ?? ''}`
    const values = runs.get(key) ?? []
    values.push(call)
    runs.set(key, values)
  }
  for (const calls of runs.values()) {
    if (calls.length >= RETRY_THRESHOLD && calls.every(call => call.isError || (trace.ended && !call.resultPresent))) {
      const first = calls[0]
      if (first === undefined) continue
      findings.push({
        code: 'retry_loop', severity: 'error', step: first.step,
        title: `Repeated failing call to ${first.name}`,
        eventSeqs: calls.flatMap(call => eventSeqs(call.callEventSeq, call.resultEventSeq)),
        evidence: [`same_call_count=${calls.length}`, `tool=${first.name}`],
        recommendation: 'Stop repeating the unchanged call; inspect its preconditions or choose another recovery path.',
      })
    }
  }

  if (trace.endReason !== undefined && trace.endReason !== 'completed') {
    findings.push({
      code: 'turn_failed', severity: 'error', step: Math.max(1, ...trace.toolCalls.map(call => call.step)),
      title: `Turn ended with ${trace.endReason}`, eventSeqs: eventSeqs(trace.endEventSeq),
      evidence: [`turn_end_reason=${trace.endReason}`],
      recommendation: 'Use the earlier tool findings as the first recovery target; do not treat the terminal state as a root cause.',
    })
  }

  findings.sort((left, right) => left.step - right.step || left.code.localeCompare(right.code))
  return {
    schemaVersion: '2', sessionId: trace.sessionId, turn: trace.turn, sourceSeq: trace.sourceSeq,
    decision: findings.length > 0 ? 'detected' : trace.ended ? 'clean' : 'inconclusive',
    findings,
    modelState: findings.length > 0 ? modelState : 'skipped_clean',
  }
}

export function formatReport(report: PostmortemReport): string {
  if (report.decision === 'clean') return `Postmortem: turn ${report.turn} has no recorded failures.`
  if (report.decision === 'inconclusive') return `Postmortem: turn ${report.turn} is still open or lacks enough recorded evidence.`
  const lines = [`Postmortem: ${report.findings.length} finding(s) in turn ${report.turn}.`]
  for (const finding of report.findings.slice(0, 4)) {
    lines.push(`- [${finding.severity}] step ${finding.step}: ${finding.title}. ${finding.recommendation}`)
  }
  if (report.modelReview !== undefined) {
    lines.push(`Model review [${report.modelReview.confidence}]: ${report.modelReview.summary}`)
    lines.push(`Immediate action: ${report.modelReview.immediateAction}`)
  } else if (report.modelState === 'failed') {
    lines.push('Model review was unavailable; deterministic findings remain authoritative.')
  }
  return lines.join('\n')
}
