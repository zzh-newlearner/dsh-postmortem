import { BlockAssembler, createUserMessage, deepFreeze, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { PostmortemReport } from './types.js'

export interface ModelConfig {
  provider: string
  model: string
  timeoutMs?: number
}

export async function explainWithModel(
  llm: LlmRuntime,
  report: PostmortemReport,
  config: ModelConfig,
  signal?: AbortSignal,
): Promise<string> {
  const evidence = report.findings.slice(0, 4).map(finding => ({
    code: finding.code,
    step: finding.step,
    title: finding.title,
    evidence: finding.evidence,
    recommendation: finding.recommendation,
  }))
  const prompt = [
    'Explain a recorded agent failure using only the structured evidence below.',
    'State the likely immediate problem and one concrete recovery action.',
    'Do not claim an unrecorded root cause. Do not request or reveal raw user content.',
    JSON.stringify({ session: report.sessionId, turn: report.turn, findings: evidence }),
  ].join('\n')
  const controller = new AbortController()
  const timer = config.timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), config.timeoutMs)
  if (signal !== undefined) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  try {
    const request = deepFreeze({
      provider: config.provider,
      model: config.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'plugin', plugin: 'dsh-postmortem' } })],
      system: 'You are a concise incident reviewer. Evidence is authoritative; unsupported claims are forbidden.',
      maxTokens: 300,
      signal: controller.signal,
    })
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(request)) assembler.push(chunk)
    const text = assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join(' ')
      .trim()
    if (text.length === 0) throw new Error('model returned no text')
    return text
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
