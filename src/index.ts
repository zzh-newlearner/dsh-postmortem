import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { diagnose, formatReport } from './diagnose.js'
import { turnFromEvents } from './adapter.js'
import { explainWithModel, type ModelConfig } from './explain.js'
import type { PostmortemReport, RecordedEvent } from './types.js'

export { diagnose, formatReport } from './diagnose.js'
export { turnFromEvents } from './adapter.js'
export type * from './types.js'

export const name = 'dsh-postmortem'
export const inject = ['commands', 'sessions']

export interface Config {
  autoOnFailure?: boolean
  model?: ModelConfig & { enabled?: boolean }
}

function sessionEvents(session: Session): RecordedEvent[] {
  return session.events.map(event => ({ type: event.type, data: event.data as Record<string, unknown> }))
}

function latestTurn(session: Session): number | undefined {
  const event = [...session.events].reverse().find(item => item.type === 'turn/end' || item.type === 'turn/start')
  const data = event?.data as { turn?: unknown } | undefined
  return typeof data?.turn === 'number' ? data.turn : undefined
}

async function reportFor(
  session: Session,
  turn: number,
  config: Config,
  llm?: LlmRuntime,
  signal?: AbortSignal,
): Promise<PostmortemReport> {
  const report = diagnose(turnFromEvents(String(session.id), turn, sessionEvents(session)))
  if (report.decision !== 'detected') return { ...report, modelState: config.model?.enabled ? 'skipped_clean' : 'disabled' }
  if (config.model?.enabled !== true || llm === undefined) return { ...report, modelState: 'disabled' }
  try {
    return { ...report, modelExplanation: await explainWithModel(llm, report, config.model, signal), modelState: 'completed' }
  } catch {
    return { ...report, modelState: 'failed' }
  }
}

/** Load as a DSH plugin. The command analyzes the latest completed turn without altering agent behavior. */
export function apply(ctx: Context, config: Config = {}): void {
  const llm = (ctx as Context & { llm?: LlmRuntime }).llm
  ctx.commands.register({
    name: 'postmortem',
    description: 'Analyze the latest agent turn for recorded failures.',
    recordInput: false,
    handler: async ({ agent, signal }): Promise<CommandResult> => {
      const turn = latestTurn(agent.session)
      if (turn === undefined) return { kind: 'error', text: 'No recorded turn is available.' }
      return { kind: 'success', text: formatReport(await reportFor(agent.session, turn, config, llm, signal)) }
    },
  })
  if (config.autoOnFailure !== true) return
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const data = event.data as { turn: number; reason: { kind?: string } }
    if (data.reason?.kind === 'completed') return
    void reportFor(session, data.turn, config, llm).then(report => {
      if (report.decision === 'detected') ctx.logger('dsh-postmortem').warn(formatReport(report))
    })
  })
}
