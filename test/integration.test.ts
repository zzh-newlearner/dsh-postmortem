import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime, { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'

describe('real DSH composition', () => {
  it('registers commands and produces a read-only repair prompt from a live session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin({ name: 'dsh-postmortem', inject: ['commands', 'sessions', 'llm'], apply }, { autoOnFailure: false })
    const session = ctx.sessions.create(SessionId('postmortem-e2e'))
    const callId = CallId('call-e2e')
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'shell', arguments: '{"cmd":"does-not-exist"}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'private output' }], isError: true }),
      error: { name: 'ToolError', code: 'ENOENT' },
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'tool failed', code: 'UNKNOWN' } } })

    const agent = { id: session.id, session, ctx } as never
    const report = await ctx.commands.execute(agent, '/postmortem', [], new AbortController().signal)
    const exported = await ctx.commands.execute(agent, '/postmortem-export 1', [], new AbortController().signal)
    const repair = await ctx.commands.execute(agent, '/postmortem-repair 1', [], new AbortController().signal)

    expect(report?.result).toMatchObject({ kind: 'success' })
    expect(report?.result.text).toContain('Tool shell failed')
    expect(exported?.result.text).toContain('"schemaVersion": "2"')
    expect(exported?.result.text).not.toContain('does-not-exist')
    expect(exported?.result.text).not.toContain('private output')
    expect(repair?.result.text).toContain('Do not repeat an unchanged failing tool call')
    expect(session.events.map(event => event.type)).not.toContain('agent/inject')
  })

  it('reports an open scheduled model retry without calling a review model', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin({ name: 'dsh-postmortem', inject: ['commands', 'sessions', 'llm'], apply }, {
      autoOnFailure: false,
      model: { enabled: true, provider: 'unconfigured', model: 'unconfigured' },
    })
    const session = ctx.sessions.create(SessionId('postmortem-retry-status'))
    session.append('turn/start', { turn: 1 })
    session.append('llm/retry', {
      turn: 1, step: 2, retry: 1, delayMs: 500, mode: 'normal', maxRetries: 5,
      provider: 'private-provider', policyKey: 'private-policy', retryId: 'private-id',
      failure: { code: 'RATE_LIMIT', message: 'private provider response' },
    } as never)

    const agent = { id: session.id, session, ctx } as never
    const report = await ctx.commands.execute(agent, '/postmortem', [], new AbortController().signal)
    const exported = await ctx.commands.execute(agent, '/postmortem-export', [], new AbortController().signal)
    const repair = await ctx.commands.execute(agent, '/postmortem-repair', [], new AbortController().signal)

    expect(report?.result.text).toContain('Model request retry 1 is scheduled')
    expect(exported?.result.text).toContain('"modelState": "disabled"')
    expect(exported?.result.text).not.toContain('private')
    expect(repair?.result).toMatchObject({ kind: 'error' })
  })
})
