import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CallId, LlmAdapter, ReasoningEffortId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply } from '../dist/index.js'

class RecoveryAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return {
      provider, id: model, name: model,
      reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }], defaultEffort: ReasoningEffortId('off') },
    }
  }

  async * stream(options) {
    const hasHandoff = options.messages.some(message => message.source.kind === 'plugin' && message.source.plugin === 'dsh-postmortem')
    const text = hasHandoff ? 'RECOVERY_COMPLETED' : 'UNEXPECTED_MODEL_CALL'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function textOf(agent) {
  const message = agent.session.events.findLast(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') return ''
  return message.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(CommandRuntime)
  ctx.llm.registerAdapter(['recovery-selfcheck'], new RecoveryAdapter())
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin({ name: 'dsh-postmortem', inject: ['commands', 'sessions', 'llm'], apply }, { autoOnFailure: false })

  const sourceId = SessionId('postmortem-recovery-agent-selfcheck')
  const session = ctx.sessions.create(sourceId)
  const source = { id: sourceId, ctx, session, options: { provider: 'recovery-selfcheck', model: 'recovery-selfcheck' } }
  const callId = CallId('recovery-agent-selfcheck-call')
  session.append('turn/start', { turn: 1 })
  session.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"private-source-command"}' })
  session.append('tool/result', {
    turn: 1, step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'private-source-output' }], isError: true }),
    error: { name: 'ToolError', code: 'ENOENT' },
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'private-source-error' } } })

  const signal = new AbortController().signal
  const next = await ctx.commands.execute(source, '/postmortem-next 1', [], signal)
  assert.equal(next?.result.kind, 'success')
  assert.match(next?.result.text ?? '', /postmortem-recover 1/)
  assert.doesNotMatch(next?.result.text ?? '', /private-source-(command|output|error)/)

  const created = await ctx.commands.execute(source, '/postmortem-recover 1', [], signal)
  assert.equal(created?.result.kind, 'success')
  const attempt = JSON.parse(created.result.text)
  const recovery = ctx.agents.get(SessionId(attempt.recoverySessionId))
  assert.ok(recovery)
  await recovery.whenIdle()
  assert.equal(recovery.session.header.parentSession, sourceId)
  assert.equal(textOf(recovery), 'RECOVERY_COMPLETED')
  assert.doesNotMatch(JSON.stringify(recovery.session.events), /private-source-(command|output|error)/)

  const status = await ctx.commands.execute(recovery, '/postmortem-recovery', [], signal)
  assert.equal(status?.result.kind, 'success')
  assert.match(status?.result.text ?? '', /"state": "completed"/)
  assert.match(status?.result.text ?? '', /"taskSuccess": "unverified"/)
  console.log('DSH recovery-agent self-check passed: guided recovery, fresh lineage, redacted handoff, and terminal status.')
} finally {
  await ctx.fiber.dispose()
}
