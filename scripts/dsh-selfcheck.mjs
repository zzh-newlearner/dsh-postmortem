import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime, { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { apply } from '../dist/index.js'

function requiredText(result, label) {
  if (result?.result?.kind !== 'success') throw new Error(`${label} command did not succeed`)
  return result.result.text
}

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(CommandRuntime)
await ctx.plugin(LlmRuntime)
await ctx.plugin({ name: 'dsh-postmortem', inject: ['commands', 'sessions', 'llm'], apply }, { autoOnFailure: false })

const session = ctx.sessions.create(SessionId('postmortem-selfcheck'))
const callId = CallId('selfcheck-call')
session.append('turn/start', { turn: 1 })
session.append('tool/call', { turn: 1, step: 1, callId, name: 'shell', arguments: '{"cmd":"private-command"}' })
session.append('tool/result', {
  turn: 1,
  step: 1,
  message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'private tool output' }], isError: true }),
  error: { name: 'ToolError', code: 'ENOENT' },
}, { surfaceOp: 'append' })
session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'private terminal message' } } })

const agent = { id: session.id, session, ctx }
const signal = new AbortController().signal
const report = requiredText(await ctx.commands.execute(agent, '/postmortem', [], signal), 'postmortem')
const exported = requiredText(await ctx.commands.execute(agent, '/postmortem-export 1', [], signal), 'postmortem-export')
const repair = requiredText(await ctx.commands.execute(agent, '/postmortem-repair 1', [], signal), 'postmortem-repair')
const combined = `${report}\n${exported}\n${repair}`

if (!report.includes('Tool shell failed') || !repair.includes('Do not repeat an unchanged failing tool call')) {
  throw new Error('expected diagnostic or recovery guidance is missing')
}
if (combined.includes('private-command') || combined.includes('private tool output') || combined.includes('private terminal message')) {
  throw new Error('private trace data escaped the postmortem boundary')
}
if (session.events.some(event => event.type === 'agent/inject')) throw new Error('self-check unexpectedly injected agent context')

console.log(report)
console.log('\nDSH command-path self-check passed: report, export, repair, redaction, and no injection.')
