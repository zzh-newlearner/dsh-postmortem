import { buildRepairPlan } from './repair.js'
import type { Finding, PostmortemReport } from './types.js'

export interface NextStepOptions {
  recoveryAvailable: boolean
}

function primaryFinding(report: PostmortemReport): Finding | undefined {
  return report.findings.find(finding => finding.code !== 'turn_failed') ?? report.findings[0]
}

/** Render one short, operator-facing next step without exposing the raw trace. */
export function formatNextStep(report: PostmortemReport, options: NextStepOptions): string {
  if (report.decision === 'clean') {
    return `Next step: turn ${report.turn} completed without a recorded failure. No recovery action is needed.`
  }
  if (report.decision === 'cancelled') {
    return `Next step: turn ${report.turn} was cancelled by the user. Restart only when the task is still needed.`
  }
  if (report.decision === 'inconclusive') {
    return report.inconclusiveReason === 'open_turn'
      ? `Next step: turn ${report.turn} is still running. Wait for it to end, then run /postmortem-next ${report.turn}.`
      : `Next step: turn ${report.turn} has no recognized DSH events. Check the selected turn and DSH/plugin compatibility first.`
  }

  const finding = primaryFinding(report)
  const plan = buildRepairPlan(report)
  const lines = [`Recovery guide for turn ${report.turn}`]
  if (finding !== undefined) {
    lines.push(`Primary issue: ${finding.title}.`)
    lines.push(`Do now: ${finding.recommendation}`)
  }
  if (plan === undefined) {
    lines.push('Wait: this turn has no repair action that is safe to start yet.')
    lines.push(`Recheck: /postmortem-next ${report.turn} after the run state changes.`)
    return lines.join('\n')
  }

  const first = plan.actions[0]
  if (first !== undefined) lines.push(`Verify first: ${first.verification}`)
  if (options.recoveryAvailable) {
    lines.push(`Then start one fresh attempt: /postmortem-recover ${report.turn}`)
  } else {
    lines.push(`Then export a fresh-attempt handoff: /postmortem-handoff ${report.turn}`)
  }
  lines.push('Task success still requires your project verifier, test command, or checker to pass.')
  return lines.join('\n')
}
