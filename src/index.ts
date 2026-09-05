import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-commands'
import '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { turnFromEvents } from './adapter.js'
import { diagnose, formatReport } from './diagnose.js'
import { explainWithModel, type ModelConfig } from './explain.js'
import { buildRepairPlan, buildRepairPrompt } from './repair.js'
import { formatNextStep } from './guidance.js'
import { PostmortemStore } from './store.js'
import { buildRecoveryHandoff, RecoveryStore } from './recovery.js'
import type { PostmortemReport, RecordedEvent } from './types.js'

export { turnFromEvents } from './adapter.js'
export { diagnose, formatReport } from './diagnose.js'
export { explainWithModel, parseModelReview, reviewPrompt, type ModelConfig } from './explain.js'
export { buildRepairPlan, buildRepairPrompt, repairPlanFingerprint } from './repair.js'
export { formatNextStep } from './guidance.js'
export { summarizeAnnotations, validateDiagnosisAdjudication, validateDiagnosisAnnotation } from './annotations.js'
export { evaluationSplit, scoreDiagnosisCorpus, validateDiagnosisDatasetRecord } from './dataset.js'
export { evaluatePairs } from './evaluation.js'
export { evaluateVerifiedPairs, validateVerifiedPairedRunRecord } from './verified-evaluation.js'
export { ModelEvaluationError, evaluateModelReviews, humanReferences, seedReferences, summarizeModelEvaluationRecords } from './model-eval.js'
export { PostmortemStore } from './store.js'
export { buildRecoveryHandoff, RecoveryStore } from './recovery.js'
export type { PairedEvaluation, PairedRunRecord, PairIssue } from './evaluation.js'
export type { VerifiedPairedEvaluation, VerifiedPairedRunRecord } from './verified-evaluation.js'
export type { RepairAction, RepairActionKind, RepairPlan } from './types.js'
export type { RecoveryAttempt, RecoveryExecutionState, RecoveryHandoff } from './recovery.js'
export type { NextStepOptions } from './guidance.js'
export type { DatasetExpectation, DatasetOrigin, DatasetOriginKind, DiagnosisCorpusScore, DiagnosisDatasetRecord, EvaluationSplit } from './dataset.js'
export type { AnnotationIssue, AnnotationPrimaryIssue, AnnotationSummary, DiagnosisAdjudication, DiagnosisAnnotation, HumanReference } from './annotations.js'
export type { ModelEvaluationCaller, ModelEvaluationCase, ModelEvaluationOptions, ModelEvaluationRecord, ModelEvaluationReference, ModelEvaluationRun, ModelEvaluationSummary } from './model-eval.js'
export type * from './types.js'

export const name = 'dsh-postmortem'
export const inject = ['commands', 'sessions', 'llm']
const PACKAGE_VERSION = '0.9.2'

export interface Config {
  /** false disables logs; detected is the quiet default; all retains legacy behavior. */
  autoOnFailure?: boolean | 'detected' | 'all'
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

interface TurnSelection {
  turns: number[]
  range: boolean
}

function lastFailedTurn(session: Session): number | undefined {
  for (const event of [...session.events].reverse()) {
    if (event.type !== 'turn/end') continue
    const data = event.data as unknown as { turn?: unknown, reason?: { kind?: unknown } }
    if (typeof data.turn === 'number' && data.reason?.kind !== 'completed') return data.turn
  }
  return undefined
}

function turnSelection(rawInput: string, session: Session): TurnSelection | undefined {
  const input = rawInput.trim()
  if (input.length === 0) {
    const turn = latestTurn(session)
    return turn === undefined ? undefined : { turns: [turn], range: false }
  }
  if (input === '--last-failed') {
    const turn = lastFailedTurn(session)
    return turn === undefined ? undefined : { turns: [turn], range: false }
  }
  if (/^\d+$/.test(input)) return { turns: [Number(input)], range: false }
  const match = /^(\d+)-(\d+)$/.exec(input)
  if (match === null) return undefined
  const start = Number(match[1])
  const end = Number(match[2])
  if (end < start || end - start > 99) return undefined
  return { turns: Array.from({ length: end - start + 1 }, (_, index) => start + index), range: true }
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
  if (cached !== undefined) return store.getPending(session.id, turn, trace.sourceSeq) ?? cached
  const enabled = model?.enabled === true && llm !== undefined && trace.pendingModelRetry === undefined
  let report = diagnose(trace, enabled ? 'pending' : 'disabled')
  const withRepairPrompt = (value: PostmortemReport): PostmortemReport => {
    const repairPrompt = buildRepairPrompt(value)
    return repairPrompt === undefined ? value : { ...value, repairPrompt }
  }
  report = store.set(withRepairPrompt(report))
  if (!enabled || report.decision !== 'detected' || model === undefined) return report
  return store.runPending(session.id, turn, trace.sourceSeq, async () => {
    try {
      const modelReview = await explainWithModel(llm, report, model, signal)
      return store.set(withRepairPrompt({ ...report, modelState: 'completed', modelReview }))
    } catch {
      return store.set(withRepairPrompt({ ...report, modelState: 'failed' }))
    }
  })
}

async function reportsFor(
  session: Session,
  selection: TurnSelection,
  store: PostmortemStore,
  model: Config['model'] | undefined,
  llm: LlmRuntime | undefined,
  signal?: AbortSignal,
): Promise<PostmortemReport[]> {
  return Promise.all(selection.turns.map(turn => reportFor(session, turn, store, model, llm, signal)))
}

function formatReports(reports: readonly PostmortemReport[]): string {
  if (reports.length === 1) return formatReport(reports[0] as PostmortemReport)
  return `Postmortem: ${reports.length} selected turns.\n\n${reports.map(report => `--- Turn ${report.turn} ---\n${formatReport(report)}`).join('\n\n')}`
}

function feedbackTemplate(reports: readonly PostmortemReport[]): string {
  return [
    '# DSH Postmortem feedback',
    '',
    `Plugin: @huichangzz/dsh-postmortem ${PACKAGE_VERSION}`,
    'Please remove any secrets or private context before submitting. The report below is redacted by the plugin.',
    '',
    '## What happened',
    '',
    '## What you expected',
    '',
    '## Redacted report',
    '```json',
    JSON.stringify(reports.length === 1 ? reports[0] : { schemaVersion: '1', reports }, null, 2),
    '```',
    '',
    'Open: https://github.com/zzh-newlearner/dsh-postmortem/issues/new/choose',
  ].join('\n')
}

function recoverySelection(rawInput: string, session: Session): number | undefined {
  const selection = turnSelection(rawInput, session)
  return selection?.range === false ? selection.turns[0] : undefined
}

export function apply(ctx: Context, config: Config = {}): void {
  const store = new PostmortemStore()
  const recoveryStore = new RecoveryStore()
  const logger = ctx.logger('dsh-postmortem')
  const llm = ctx.llm as LlmRuntime

  ctx.effect(() => () => { void recoveryStore.dispose() })
  ctx.on('session/event', (session, event) => {
    recoveryStore.observe(session.id, event as unknown as { type: string, data: Record<string, unknown> })
  })

  ctx.commands.register({
    name: 'postmortem-next',
    description: 'Show one concise, safe next step for a failed turn.',
    input: { hint: '[turn|--last-failed]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const turn = recoverySelection(rawInput, agent.session)
      if (turn === undefined) return { kind: 'error', text: 'Usage: /postmortem-next [turn|--last-failed]' }
      const report = await reportFor(agent.session, turn, store, config.model, llm, signal)
      return {
        kind: 'success',
        text: formatNextStep(report, { recoveryAvailable: agent.ctx.get('agents') !== undefined }),
      }
    },
  })

  ctx.commands.register({
    name: 'postmortem-handoff',
    description: 'Export a redacted handoff for one fresh recovery attempt.',
    input: { hint: '[turn|--last-failed]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const turn = recoverySelection(rawInput, agent.session)
      if (turn === undefined) return { kind: 'error', text: 'Usage: /postmortem-handoff [turn|--last-failed]' }
      const report = await reportFor(agent.session, turn, store, config.model, llm, signal)
      const handoff = buildRecoveryHandoff(report)
      if (handoff === undefined) return { kind: 'error', text: 'No actionable failed turn is available for a recovery handoff.' }
      return { kind: 'success', text: JSON.stringify(handoff, null, 2) }
    },
  })

  ctx.commands.register({
    name: 'postmortem-recover',
    description: 'Create a fresh DSH recovery agent from one redacted handoff.',
    input: { hint: '[turn|--last-failed]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const turn = recoverySelection(rawInput, agent.session)
      if (turn === undefined) return { kind: 'error', text: 'Usage: /postmortem-recover [turn|--last-failed]' }
      const report = await reportFor(agent.session, turn, store, config.model, llm, signal)
      const handoff = buildRecoveryHandoff(report)
      if (handoff === undefined) return { kind: 'error', text: 'No actionable failed turn is available for recovery.' }
      try {
        const attempt = await recoveryStore.start(agent as Agent, handoff, signal)
        return { kind: 'success', text: JSON.stringify(attempt, null, 2) }
      } catch (error: unknown) {
        return { kind: 'error', text: error instanceof Error ? error.message : 'Unable to create a fresh DSH recovery agent.' }
      }
    },
  })

  ctx.commands.register({
    name: 'postmortem-recovery',
    description: 'Show the local execution state of this recovery attempt.',
    recordInput: false,
    async handler({ agent }) {
      const attempt = recoveryStore.get(agent.session.id)
      if (attempt === undefined) return { kind: 'error', text: 'This session is not a postmortem recovery attempt.' }
      return { kind: 'success', text: JSON.stringify(attempt, null, 2) }
    },
  })

  ctx.commands.register({
    name: 'postmortem-plan',
    description: 'Export a copy-only, machine-readable repair plan for a failed turn.',
    input: { hint: '[turn|from-to|--last-failed]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const selection = turnSelection(rawInput, agent.session)
      if (selection === undefined) return { kind: 'error', text: 'Usage: /postmortem-plan [turn|from-to|--last-failed]' }
      const reports = await reportsFor(agent.session, selection, store, config.model, llm, signal)
      const plans = reports.map(report => ({ turn: report.turn, plan: buildRepairPlan(report) }))
      if (plans.every(value => value.plan === undefined)) {
        return { kind: 'error', text: 'No actionable repair plan is available for the selected turn(s).' }
      }
      return selection.range
        ? { kind: 'success', text: JSON.stringify({ schemaVersion: '1', plans }, null, 2) }
        : { kind: 'success', text: JSON.stringify(plans[0]?.plan, null, 2) }
    },
  })

  ctx.commands.register({
    name: 'postmortem',
    description: 'Show a local, redacted postmortem for the latest or selected turn.',
    input: { hint: '[turn|from-to|--last-failed]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const selection = turnSelection(rawInput, agent.session)
      if (selection === undefined) return { kind: 'error', text: 'Usage: /postmortem [turn|from-to|--last-failed]' }
      const reports = await reportsFor(agent.session, selection, store, config.model, llm, signal)
      return { kind: 'success', text: formatReports(reports) }
    },
  })

  ctx.commands.register({
    name: 'postmortem-export',
    description: 'Export the redacted structured postmortem for a turn.',
    input: { hint: '[turn|from-to|--last-failed]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const selection = turnSelection(rawInput, agent.session)
      if (selection === undefined) return { kind: 'error', text: 'Usage: /postmortem-export [turn|from-to|--last-failed]' }
      const reports = await reportsFor(agent.session, selection, store, config.model, llm, signal)
      return { kind: 'success', text: JSON.stringify(selection.range ? { schemaVersion: '1', reports } : reports[0], null, 2) }
    },
  })

  ctx.commands.register({
    name: 'postmortem-repair',
    description: 'Render a copy-only repair prompt for a failed turn.',
    input: { hint: '[turn|from-to|--last-failed]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const selection = turnSelection(rawInput, agent.session)
      if (selection === undefined) return { kind: 'error', text: 'Usage: /postmortem-repair [turn|from-to|--last-failed]' }
      const reports = await reportsFor(agent.session, selection, store, config.model, llm, signal)
      const prompts = reports.flatMap(report => report.repairPrompt === undefined ? [] : [{ turn: report.turn, prompt: report.repairPrompt }])
      if (prompts.length === 0) return { kind: 'error', text: 'No failed turn is available to repair.' }
      return { kind: 'success', text: prompts.length === 1 ? prompts[0]?.prompt ?? '' : prompts.map(value => `--- Turn ${value.turn} ---\n${value.prompt}`).join('\n\n') }
    },
  })

  ctx.commands.register({
    name: 'postmortem-feedback',
    description: 'Render a redacted feedback template for a selected turn or range.',
    input: { hint: '[turn|from-to|--last-failed]' },
    recordInput: false,
    async handler({ agent, rawInput, signal }) {
      const selection = turnSelection(rawInput, agent.session)
      if (selection === undefined) return { kind: 'error', text: 'Usage: /postmortem-feedback [turn|from-to|--last-failed]' }
      const reports = await reportsFor(agent.session, selection, store, config.model, llm, signal)
      return { kind: 'success', text: feedbackTemplate(reports) }
    },
  })

  if (config.autoOnFailure !== false) {
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end' || event.data.reason.kind === 'completed') return
      void reportFor(session, event.data.turn, store, config.model, llm)
        .then(report => {
          const mode = config.autoOnFailure ?? 'detected'
          if (mode === true || mode === 'all' || report.decision === 'detected') logger.warn(formatReport(report))
        })
    })
  }
}
