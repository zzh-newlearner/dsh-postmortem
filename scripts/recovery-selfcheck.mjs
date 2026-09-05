import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime, { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { apply } from '../dist/index.js'

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(CommandRuntime)
await ctx.plugin(LlmRuntime)
await ctx.plugin({ name: 'dsh-postmortem', inject: ['commands', 'sessions', 'llm'], apply }, { autoOnFailure: false })

const session = ctx.sessions.create(SessionId('postmortem-recovery-selfcheck'))
const callId = CallId('recovery-selfcheck-call')
session.append('turn/start', { turn: 1 })
session.append('tool/call', {
  turn: 1, step: 1, callId, name: 'shell', arguments: '{"command":"private-source-command"}',
})
session.append('tool/result', {
  turn: 1, step: 1,
  message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'private-source-output' }], isError: true }),
  error: { name: 'ToolError', code: 'ENOENT' },
}, { surfaceOp: 'append' })
session.append('turn/end', {
  turn: 1,
  reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'private-source-error' } },
})

const agent = { id: session.id, session, ctx, options: {} }
const signal = new AbortController().signal
const handoff = await ctx.commands.execute(agent, '/postmortem-handoff 1', [], signal)
const recover = await ctx.commands.execute(agent, '/postmortem-recover 1', [], signal)

assert.equal(handoff?.result.kind, 'success')
assert.match(handoff?.result.text ?? '', /"repairPlanFingerprint"/)
assert.doesNotMatch(handoff?.result.text ?? '', /private-source-(command|output|error)/)
assert.equal(recover?.result.kind, 'error')
assert.match(recover?.result.text ?? '', /agent creation is unavailable/)
assert.deepEqual(session.events.filter(event => event.type === 'agent/inject'), [])
console.log('DSH recovery self-check passed: redacted handoff, explicit-only recovery, and unavailable-runtime guard.')
