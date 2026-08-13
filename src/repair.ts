import type { PostmortemReport } from './types.js'

/**
 * A copy-only prompt. It is intentionally deterministic so a failed model review
 * cannot produce an unsafe follow-up, and this module has no Agent dependency.
 */
export function buildRepairPrompt(report: PostmortemReport): string | undefined {
  if (report.decision !== 'detected') return undefined
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
