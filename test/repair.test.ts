import { describe, expect, it } from 'vitest'
import { diagnose } from '../src/diagnose.js'
import { buildRepairPlan } from '../src/repair.js'

describe('repair plans', () => {
  it('turns deterministic evidence into copy-only, verifiable actions', () => {
    const report = diagnose({
      sessionId: 'repair-session', turn: 2, sourceSeq: 9, ended: true, endReason: 'error',
      toolCalls: [{ callId: 'opaque-call', name: 'shell', step: 1, isError: true, errorCode: 'ENOENT', resultPresent: true }],
    })
    const plan = buildRepairPlan(report)
    expect(plan).toMatchObject({ schemaVersion: '1', sessionId: 'repair-session', turn: 2 })
    expect(plan?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingCode: 'tool_error', kind: 'check_resource', execution: 'copy_only' }),
      expect.objectContaining({ findingCode: 'turn_failed', kind: 'review_prior_findings', execution: 'copy_only' }),
    ]))
    expect(JSON.stringify(plan)).not.toContain('opaque-call')
  })

  it('maps credential, rate-limit, and token failures to bounded checks', () => {
    const credentials = buildRepairPlan(diagnose({
      sessionId: 's', turn: 1, sourceSeq: 1, ended: true, endReason: 'error', endErrorCode: 'MISSING_CREDENTIAL', toolCalls: [],
    }))
    const rateLimit = buildRepairPlan(diagnose({
      sessionId: 's', turn: 1, sourceSeq: 1, ended: true, endReason: 'error', endErrorCode: 'RATE_LIMIT', toolCalls: [],
    }))
    const maxTokens = buildRepairPlan(diagnose({
      sessionId: 's', turn: 1, sourceSeq: 1, ended: true, endReason: 'max-tokens', toolCalls: [],
    }))
    expect(credentials?.actions[0]?.kind).toBe('correct_credential')
    expect(rateLimit?.actions[0]?.kind).toBe('wait_for_rate_limit')
    expect(maxTokens?.actions[0]?.kind).toBe('reduce_context')
  })

  it('does not manufacture a plan for cancellations or a live model retry', () => {
    const cancelled = diagnose({ sessionId: 's', turn: 1, sourceSeq: 1, ended: true, endReason: 'aborted', endAbortCause: 'user', toolCalls: [] })
    const liveRetry = diagnose({
      sessionId: 's', turn: 1, sourceSeq: 1, ended: false, toolCalls: [],
      pendingModelRetry: { step: 1, retry: 1, delayMs: 100, mode: 'normal' },
    })
    expect(buildRepairPlan(cancelled)).toBeUndefined()
    expect(buildRepairPlan(liveRetry)).toBeUndefined()
  })
})
