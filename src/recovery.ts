import { randomUUID } from 'node:crypto'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { repairPlanFingerprint, buildRepairPlan, buildRepairPrompt } from './repair.js'
import type { PostmortemReport, RepairPlan } from './types.js'

export interface RecoveryHandoff {
  schemaVersion: '1'
  sourceSessionId: string
  sourceTurn: number
  sourceSeq: number
  repairPlanFingerprint: string
  /** Redacted, copy-only first message for the recovery agent. */
  prompt: string
}

export type RecoveryExecutionState = 'running' | 'completed' | 'failed'

export interface RecoveryAttempt {
  schemaVersion: '1'
  recoverySessionId: string
  sourceSessionId: string
  sourceTurn: number
  repairPlanFingerprint: string
  state: RecoveryExecutionState
  endedTurn?: number
  endReason?: string
  /** Execution completion is not a task-success claim. */
  taskSuccess: 'unverified'
}

function handoffPlan(report: PostmortemReport): RepairPlan | undefined {
  if (report.decision !== 'detected') return undefined
  return buildRepairPlan(report)
}

/** Build a redacted handoff without retaining the source transcript or event log. */
export function buildRecoveryHandoff(report: PostmortemReport): RecoveryHandoff | undefined {
  const plan = handoffPlan(report)
  const prompt = buildRepairPrompt(report)
  if (plan === undefined || prompt === undefined) return undefined
  return {
    schemaVersion: '1',
    sourceSessionId: report.sessionId,
    sourceTurn: report.turn,
    sourceSeq: report.sourceSeq,
    repairPlanFingerprint: repairPlanFingerprint(plan),
    prompt,
  }
}

/** Owns created recovery handles and tracks only redacted lineage/outcome metadata. */
export class RecoveryStore {
  private readonly attempts = new Map<string, RecoveryAttempt>()
  private readonly handles = new Map<string, AgentHandle>()

  start(source: Agent, handoff: RecoveryHandoff, signal?: AbortSignal): Promise<RecoveryAttempt> {
    const agents = source.ctx.get('agents')
    if (agents === undefined) return Promise.reject(new Error('DSH agent creation is unavailable; use /postmortem-handoff to start a fresh attempt manually.'))
    const recoverySessionId = SessionId(`postmortem-recovery-${randomUUID()}`)
    return agents.create({
      sessionId: recoverySessionId,
      meta: {
        ...(source.session.header.cwd === undefined ? {} : { cwd: source.session.header.cwd }),
        parentSession: source.session.header.id,
      },
      agentOptions: source.options,
      signal,
    }).then(handle => {
      const attempt: RecoveryAttempt = {
        schemaVersion: '1', recoverySessionId, sourceSessionId: handoff.sourceSessionId,
        sourceTurn: handoff.sourceTurn, repairPlanFingerprint: handoff.repairPlanFingerprint,
        state: 'running', taskSuccess: 'unverified',
      }
      this.attempts.set(recoverySessionId, attempt)
      this.handles.set(recoverySessionId, handle)
      try {
        handle.agent.followup(createUserMessage({
          content: [{ type: 'text', text: handoff.prompt }],
          source: { kind: 'plugin', plugin: 'dsh-postmortem' },
        }))
      } catch (error) {
        this.attempts.delete(recoverySessionId)
        this.handles.delete(recoverySessionId)
        return handle.dispose().then(() => { throw error })
      }
      return attempt
    })
  }

  get(recoverySessionId: string): RecoveryAttempt | undefined {
    return this.attempts.get(recoverySessionId)
  }

  /** Observe only terminal metadata; detailed task verification belongs to the caller's protocol. */
  observe(sessionId: string, event: { type: string, data: Record<string, unknown> }): void {
    if (event.type !== 'turn/end') return
    const current = this.attempts.get(sessionId)
    if (current === undefined || current.state !== 'running') return
    const turn = typeof event.data.turn === 'number' ? event.data.turn : undefined
    const reason = typeof event.data.reason === 'object' && event.data.reason !== null
      ? event.data.reason as Record<string, unknown>
      : undefined
    const kind = typeof reason?.kind === 'string' ? reason.kind : 'unknown'
    this.attempts.set(sessionId, {
      ...current,
      state: kind === 'completed' ? 'completed' : 'failed',
      ...(turn === undefined ? {} : { endedTurn: turn }),
      endReason: kind,
    })
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.handles.values()].map(handle => handle.dispose()))
    this.handles.clear()
  }
}
