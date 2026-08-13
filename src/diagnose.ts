import type { Finding, PostmortemReport, ToolCall, TurnTrace } from './types.js'

const RETRY_THRESHOLD = 3

function stepForCall(trace: TurnTrace, target: ToolCall): number {
  return trace.toolCalls.indexOf(target) + 1
}

function toolSummary(call: ToolCall): string {
  return `tool=${call.name}, call=${call.callId}`
}

export function diagnose(trace: TurnTrace): PostmortemReport {
  const findings: Finding[] = []
  for (const call of trace.toolCalls) {
    if (call.isError) {
      findings.push({
        code: 'tool_error',
        severity: 'error',
        step: stepForCall(trace, call),
        title: `Tool ${call.name} failed`,
        evidence: [toolSummary(call), ...(call.errorCode ? [`error_code=${call.errorCode}`] : [])],
        recommendation: 'Inspect the tool arguments and error code before retrying this action.',
      })
    }
    if (call.result === undefined) {
      findings.push({
        code: 'missing_result',
        severity: 'warning',
        step: stepForCall(trace, call),
        title: `Tool ${call.name} has no recorded result`,
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
    if (calls.length >= RETRY_THRESHOLD && calls.every(call => call.isError || call.result === undefined)) {
      const first = calls[0]
      if (first === undefined) continue
      findings.push({
        code: 'retry_loop',
        severity: 'error',
        step: stepForCall(trace, first),
        title: `Repeated failing call to ${first.name}`,
        evidence: [`same_call_count=${calls.length}`, `tool=${first.name}`],
        recommendation: 'Stop repeating the unchanged call; inspect its preconditions or choose another recovery path.',
      })
    }
  }

  if (trace.endReason !== undefined && trace.endReason !== 'completed') {
    findings.push({
      code: 'turn_failed',
      severity: 'error',
      step: Math.max(1, trace.toolCalls.length),
      title: `Turn ended with ${trace.endReason}`,
      evidence: [`turn_end_reason=${trace.endReason}`],
      recommendation: 'Use the earlier tool findings as the first recovery target; do not treat the terminal state as a root cause.',
    })
  }

  findings.sort((left, right) => right.severity.localeCompare(left.severity) || left.step - right.step)
  return {
    schemaVersion: '1',
    sessionId: trace.sessionId,
    turn: trace.turn,
    decision: findings.length > 0 ? 'detected' : trace.ended ? 'clean' : 'inconclusive',
    findings,
  }
}

export function formatReport(report: PostmortemReport): string {
  if (report.decision === 'clean') return `Postmortem: turn ${report.turn} has no recorded failures.`
  if (report.decision === 'inconclusive') return `Postmortem: turn ${report.turn} is still open or lacks enough recorded evidence.`
  const lines = [`Postmortem: ${report.findings.length} finding(s) in turn ${report.turn}.`]
  for (const finding of report.findings.slice(0, 3)) {
    lines.push(`- [${finding.severity}] step ${finding.step}: ${finding.title}. ${finding.recommendation}`)
  }
  if (report.modelExplanation !== undefined) lines.push(`Model review: ${report.modelExplanation}`)
  return lines.join('\n')
}
