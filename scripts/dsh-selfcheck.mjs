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
const plan = requiredText(await ctx.commands.execute(agent, '/postmortem-plan 1', [], signal), 'postmortem-plan')
const repair = requiredText(await ctx.commands.execute(agent, '/postmortem-repair 1', [], signal), 'postmortem-repair')
const feedback = requiredText(await ctx.commands.execute(agent, '/postmortem-feedback 1', [], signal), 'postmortem-feedback')
const combined = `${report}\n${exported}\n${plan}\n${repair}\n${feedback}`

if (!report.includes('Tool shell failed') || !repair.includes('Do not repeat an unchanged failing tool call')) {
  throw new Error('expected diagnostic or recovery guidance is missing')
}
if (!plan.includes('"execution": "copy_only"') || !plan.includes('"verification"')) {
  throw new Error('repair plan did not preserve its copy-only and verification boundaries')
}
if (!feedback.includes('issues/new/choose') || !repair.includes('fresh agent attempt')) {
  throw new Error('feedback or fresh-attempt guidance is missing')
}
if (combined.includes('private-command') || combined.includes('private tool output') || combined.includes('private terminal message')) {
  throw new Error('private trace data escaped the postmortem boundary')
}
if (session.events.some(event => event.type === 'agent/inject')) throw new Error('self-check unexpectedly injected agent context')

const headlessSession = ctx.sessions.create(SessionId('postmortem-empty-headless-ids'))
const emptyCallId = CallId('')
headlessSession.append('turn/start', { turn: 1 })
for (const step of [1, 2, 3]) {
  headlessSession.append('tool/call', {
    turn: 1, step, callId: emptyCallId, name: '',
    arguments: JSON.stringify({ command: 'cat /nonexistent/seed.txt', description: `Retry description ${step}` }),
  })
  headlessSession.append('tool/result', {
    turn: 1, step,
    message: createToolResultMessage({ callId: emptyCallId, content: [{ type: 'text', text: 'private output' }], isError: true }),
    error: { name: 'ToolError', code: 'ENOENT' },
  }, { surfaceOp: 'append' })
}
headlessSession.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'private terminal message' } } })
const headlessAgent = { id: headlessSession.id, session: headlessSession, ctx }
const headlessReport = requiredText(await ctx.commands.execute(headlessAgent, '/postmortem 1', [], signal), 'empty-id postmortem')
const headlessExport = requiredText(await ctx.commands.execute(headlessAgent, '/postmortem-export 1', [], signal), 'empty-id postmortem-export')
if (!headlessReport.includes('Tool cat failed') || !headlessReport.includes('Repeated failing call to cat')) {
  throw new Error('empty headless call IDs did not produce a paired retry-loop diagnosis')
}
if (headlessExport.includes('seed.txt') || headlessExport.includes('Retry description')) {
  throw new Error('empty-id diagnosis leaked a raw command or description')
}

console.log(report)
console.log('\nDSH command-path self-check passed: report, export, plan, repair, feedback, empty-ID headless pairing, redaction, and no injection.')
