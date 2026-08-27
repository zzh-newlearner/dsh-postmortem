import type { Finding, PostmortemReport, RepairAction, RepairActionKind, RepairPlan } from './types.js'
import { stableFingerprint } from './fingerprint.js'

interface ActionTemplate {
  kind: RepairActionKind
  action: string
  verification: string
}

function actionFor(finding: Finding): ActionTemplate | undefined {
  if (finding.code === 'tool_error') {
    switch (finding.evidence.find(value => value.startsWith('error_code='))?.slice('error_code='.length)) {
      case 'ENOENT': return {
        kind: 'check_resource',
        action: 'Check that the requested executable or resource exists, then update the reference before one new call.',
        verification: 'Confirm the resource is available before issuing a changed call.',
      }
      case 'EACCES':
      case 'EPERM': return {
        kind: 'check_permission',
        action: 'Check the required permission or approval before retrying the action.',
        verification: 'Confirm the required permission has been granted before one new call.',
      }
      case 'TOOL_OUTCOME_UNKNOWN': return {
        kind: 'check_external_state',
        action: 'Inspect external state before deciding whether a retry is safe.',
        verification: 'Establish whether the original operation completed before any retry.',
      }
      default: return {
        kind: 'inspect_tool_arguments',
        action: 'Inspect the tool arguments and error code, then change the precondition or arguments before retrying.',
        verification: 'Record the changed precondition or argument before one new call.',
      }
    }
  }
  if (finding.code === 'retry_loop') return {
    kind: 'stop_unchanged_retry',
    action: 'Stop repeating the unchanged failing call and choose a different recovery path.',
    verification: 'The next tool call must have a different precondition, arguments, or recovery strategy.',
  }
  if (finding.code !== 'turn_failed') return undefined
  const code = finding.evidence.find(value => value.startsWith('turn_error_code='))?.slice('turn_error_code='.length)
  const reason = finding.evidence.find(value => value.startsWith('turn_end_reason='))?.slice('turn_end_reason='.length)
  if (code === 'MISSING_CREDENTIAL' || code === 'INVALID_CREDENTIAL') return {
    kind: 'correct_credential',
    action: 'Correct the provider credential configuration before restarting the task.',
    verification: 'Run a non-sensitive provider authentication check before a new task attempt.',
  }
  if (code === 'RATE_LIMIT') return {
    kind: 'wait_for_rate_limit',
    action: 'Wait for the provider limit or reduce request pressure before restarting the task.',
    verification: 'Confirm capacity is available and keep the next attempt within the configured retry budget.',
  }
  if (reason === 'max-tokens') return {
    kind: 'reduce_context',
    action: 'Resume with a shorter plan or summarize completed work before continuing.',
    verification: 'Confirm the resumed prompt fits the available token budget.',
  }
  return {
    kind: 'review_prior_findings',
    action: 'Use earlier causal findings as the first recovery target; do not treat the terminal state as a root cause.',
    verification: 'Choose one earlier finding and state the changed precondition before retrying.',
  }
}

/** Convert a detected report into copy-only actions suitable for a separate runner. */
export function buildRepairPlan(report: PostmortemReport): RepairPlan | undefined {
  if (report.decision !== 'detected') return undefined
  const actions: RepairAction[] = []
  const seen = new Set<string>()
  for (const finding of report.findings) {
    const template = actionFor(finding)
    if (template === undefined) continue
    const key = `${finding.step}\u0000${template.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    actions.push({
      id: `repair-${actions.length + 1}`,
      findingCode: finding.code,
      step: finding.step,
      kind: template.kind,
      execution: 'copy_only',
      action: template.action,
      verification: template.verification,
    })
  }
  return actions.length === 0 ? undefined : {
    schemaVersion: '1',
    sessionId: report.sessionId,
    turn: report.turn,
    sourceSeq: report.sourceSeq,
    actions,
  }
}

/** A runner may record this one-way value instead of retaining the plan itself. */
export function repairPlanFingerprint(plan: RepairPlan): string {
  return stableFingerprint(plan)
}

/**
 * A copy-only prompt. It is intentionally deterministic so a failed model review
 * cannot produce an unsafe follow-up, and this module has no Agent dependency.
 */
export function buildRepairPrompt(report: PostmortemReport): string | undefined {
  if (report.decision !== 'detected') return undefined
  if (report.findings.every(finding => finding.code === 'model_retry')) return undefined
  const lines = [
    'Repair the previous agent attempt using only the evidence below.',
    'Do not repeat an unchanged failing tool call. Inspect preconditions before any retry.',
    'Do not expose secrets, raw user content, or raw tool output in the response.',
    '',
    'Recorded observations:',
  ]
  for (const finding of report.findings.slice(0, 4)) {
    lines.push(`- Step ${finding.step}: ${finding.title}. Recommended: ${finding.recommendation}`)
  }
  if (report.modelReview !== undefined) lines.push(`Suggested immediate action: ${report.modelReview.immediateAction}`)
  lines.push('', 'First state the revised plan and its checks, then execute it one step at a time.')
  return lines.join('\n')
}
