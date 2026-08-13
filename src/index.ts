import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-commands'
import '@deepseek-ai/dsh-session'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { turnFromEvents } from './adapter.js'
import { diagnose, formatReport } from './diagnose.js'
import { explainWithModel, type ModelConfig } from './explain.js'
import { buildRepairPrompt } from './repair.js'
import { PostmortemStore } from './store.js'
import type { PostmortemReport, RecordedEvent } from './types.js'

export { turnFromEvents } from './adapter.js'
export { diagnose, formatReport } from './diagnose.js'
export { explainWithModel, parseModelReview, reviewPrompt, type ModelConfig } from './explain.js'
export { buildRepairPrompt } from './repair.js'
export { evaluatePairs } from './evaluation.js'
export { PostmortemStore } from './store.js'
export type { PairedEvaluation, PairedRunRecord, PairIssue } from './evaluation.js'
export type * from './types.js'

export const name = 'dsh-postmortem'
export const inject = ['commands', 'sessions', 'llm']

export interface Config {
  /** Cache a report when a turn ends unsuccessfully. Defaults to true. */
  autoOnFailure?: boolean
  model?: ModelConfig & { enabled?: boolean }
}

function recordedEvents(session: Session): RecordedEvent[] {
  return session.events.map(event => ({
    type: event.type,
    seq: event.seq,
    data: event.data as unknown as Record<string, unknown>,
  }))
}

function latestTurn(session: Session): number | undefined {
  for (const event of [...session.events].reverse()) {
    if ((event.type === 'turn/end' || event.type === 'turn/start') && typeof event.data.turn === 'number') return event.data.turn
  }
  return undefined
}

function turnArgument(rawInput: string, session: Session): number | undefined {
  const input = rawInput.trim()
  if (input.length === 0) return latestTurn(session)
  return /^\d+$/.test(input) ? Number(input) : undefined
}

async function reportFor(
  session: Session,
  turn: number,
  store: PostmortemStore,
  model: Config['model'] | undefined,
  llm: LlmRuntime | undefined,
  signal?: AbortSignal,
): Promise<PostmortemReport> {
  const trace = turnFromEvents(session.id, turn, recordedEvents(session))
  const cached = store.get(session.id, turn, trace.sourceSeq)
  if (cached !== undefined) return cached
  const enabled = model?.enabled === true && llm !== undefined
  let report = diagnose(trace, enabled ? 'failed' : 'disabled')
  if (enabled && report.decision === 'detected' && model !== undefined) {
    try {
      const modelReview = await explainWithModel(llm, report, model, signal)
      report = { ...report, modelState: 'completed', modelReview }
    } catch {
      report = { ...report, modelState: 'failed' }
    }
  }
  const repairPrompt = buildRepairPrompt(report)
  return store.set(repairPrompt === undefined ? report : { ...report, repairPrompt })
}

export function apply(ctx: Context, config: Config = {}): void {
  const store = new PostmortemStore()
  const logger = ctx.logger('dsh-postmortem')
  const llm = ctx.llm as LlmRuntime

  ctx.commands.register({
    name: 'postmortem',
    description: 'Show a local, redacted postmortem for the latest or selected turn.',
    input: { hint: '[turn]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const turn = turnArgument(rawInput, agent.session)
      if (turn === undefined) return { kind: 'error', text: 'Usage: /postmortem [turn]' }
      const report = await reportFor(agent.session, turn, store, config.model, llm, signal)
      return { kind: 'success', text: formatReport(report) }
    },
  })

  ctx.commands.register({
    name: 'postmortem-export',
    description: 'Export the redacted structured postmortem for a turn.',
    input: { hint: '[turn]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const turn = turnArgument(rawInput, agent.session)
      if (turn === undefined) return { kind: 'error', text: 'Usage: /postmortem-export [turn]' }
      const report = await reportFor(agent.session, turn, store, config.model, llm, signal)
      return { kind: 'success', text: JSON.stringify(report, null, 2) }
    },
  })

  ctx.commands.register({
    name: 'postmortem-repair',
    description: 'Render a copy-only repair prompt for a failed turn.',
    input: { hint: '[turn]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const turn = turnArgument(rawInput, agent.session)
      if (turn === undefined) return { kind: 'error', text: 'Usage: /postmortem-repair [turn]' }
      const report = await reportFor(agent.session, turn, store, config.model, llm, signal)
      return report.repairPrompt === undefined
        ? { kind: 'error', text: 'No failed turn is available to repair.' }
        : { kind: 'success', text: report.repairPrompt }
    },
  })

  if (config.autoOnFailure !== false) {
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end' || event.data.reason.kind === 'completed') return
      void reportFor(session, event.data.turn, store, config.model, llm)
        .then(report => logger.warn(formatReport(report)))
    })
  }
}
