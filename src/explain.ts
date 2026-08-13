import { BlockAssembler, createUserMessage, deepFreeze, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ModelReview, PostmortemReport } from './types.js'

export interface ModelConfig {
  provider: string
  model: string
  timeoutMs?: number
}

const MAX_FIELD_LENGTH = 600

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_FIELD_LENGTH
}

/** Validate model JSON before it becomes part of a report. Invalid output is discarded. */
export function parseModelReview(text: string, allowedSteps: readonly number[]): ModelReview | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>
  const expectedKeys = ['confidence', 'evidenceSteps', 'immediateAction', 'summary']
  if (Object.keys(object).sort().join(',') !== expectedKeys.join(',')) return undefined
  if (!validText(object.summary) || !validText(object.immediateAction)) return undefined
  if (object.confidence !== 'low' && object.confidence !== 'medium' && object.confidence !== 'high') return undefined
  if (!Array.isArray(object.evidenceSteps)
    || object.evidenceSteps.some(step => !Number.isSafeInteger(step) || !allowedSteps.includes(step))) return undefined
  const evidenceSteps = [...new Set(object.evidenceSteps as number[])].sort((left, right) => left - right)
  if (evidenceSteps.length === 0) return undefined
  return { summary: object.summary.trim(), immediateAction: object.immediateAction.trim(), evidenceSteps, confidence: object.confidence }
}

export function reviewPrompt(report: PostmortemReport): string {
  const findings = report.findings.slice(0, 4).map(finding => ({
    code: finding.code,
    step: finding.step,
    eventSeqs: finding.eventSeqs,
    evidence: finding.evidence,
    recommendation: finding.recommendation,
  }))
  return [
    'Review only the recorded evidence below. Do not infer a root cause that is not recorded.',
    'Return exactly one JSON object, with no markdown and no additional keys:',
    '{"summary":"...","immediateAction":"...","evidenceSteps":[1],"confidence":"low|medium|high"}',
    'Never request or reveal user content, tool arguments, tool output, files, prompts, or credentials.',
    JSON.stringify({ turn: report.turn, findings }),
  ].join('\n')
}

export async function explainWithModel(
  llm: LlmRuntime,
  report: PostmortemReport,
  config: ModelConfig,
  signal?: AbortSignal,
): Promise<ModelReview> {
  const controller = new AbortController()
  const timer = config.timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), config.timeoutMs)
  if (signal !== undefined) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  try {
    const request = deepFreeze({
      provider: config.provider,
      model: config.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: reviewPrompt(report) }], source: { kind: 'plugin', plugin: 'dsh-postmortem' } })],
      system: 'You are a constrained incident reviewer. The evidence is authoritative and unsupported claims are forbidden.',
      maxTokens: 240,
      signal: controller.signal,
    })
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(request)) assembler.push(chunk)
    const text = assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    const review = parseModelReview(text, report.findings.map(finding => finding.step))
    if (review === undefined) throw new Error('model returned invalid postmortem JSON')
    return review
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
