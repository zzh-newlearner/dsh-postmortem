import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CallId, LlmAdapter, ReasoningEffortId, createToolResultMessage, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'

class RecoveryAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider, id: model, name: model,
      reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }], defaultEffort: ReasoningEffortId('off') },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const hasHandoff = options.messages.some(message => message.source.kind === 'plugin' && message.source.plugin === 'dsh-postmortem')
    const text = hasHandoff ? 'RECOVERY_COMPLETED' : 'UNEXPECTED_MODEL_CALL'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function finalText(agent: Agent): string {
  const message = [...agent.session.events].reverse().find(event => event.type === 'assistant/message')
  return message?.type === 'assistant/message'
    ? message.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    : ''
}

describe('real DSH recovery attempt', () => {
  it('creates a fresh lineage-linked agent, hands off redacted evidence, and records completion', async () => {
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(CommandRuntime)
      await ctx.plugin({ name: 'recovery-adapter', inject: ['llm'], apply(inner) {
        inner.llm.registerAdapter(['recovery-test'], new RecoveryAdapter())
      } })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin({ name: 'dsh-postmortem', inject: ['commands', 'sessions', 'llm'], apply }, { autoOnFailure: false })

      const sourceId = SessionId('recovery-source')
      const sourceSession = ctx.sessions.create(sourceId)
      const source = { id: sourceId, ctx, session: sourceSession, options: { provider: 'recovery-test', model: 'recovery-test' } } as Agent
      const callId = CallId('failed-call')
      sourceSession.append('turn/start', { turn: 1 })
      sourceSession.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"private-source-command"}' })
      sourceSession.append('tool/result', {
        turn: 1, step: 1,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'private-source-output' }], isError: true }),
        error: { name: 'ToolError', code: 'ENOENT' },
      }, { surfaceOp: 'append' })
      sourceSession.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'private-source-error' } } })

      const next = await ctx.commands.execute(source, '/postmortem-next 1', [], new AbortController().signal)
      const result = await ctx.commands.execute(source, '/postmortem-recover 1', [], new AbortController().signal)
      expect(next?.result.text).toContain('/postmortem-recover 1')
      expect(next?.result.text).not.toContain('private-source-command')
      expect(result?.result).toMatchObject({ kind: 'success' })
      const attempt = JSON.parse(result?.result.text ?? '{}') as { recoverySessionId?: string, state?: string, taskSuccess?: string }
      expect(attempt).toMatchObject({ state: 'running', taskSuccess: 'unverified' })
      const recovery = attempt.recoverySessionId === undefined ? undefined : ctx.agents.get(SessionId(attempt.recoverySessionId))
      expect(recovery).toBeDefined()
      await recovery?.whenIdle()

      expect(recovery?.session.header.parentSession).toBe(sourceId)
      expect(finalText(recovery as Agent)).toBe('RECOVERY_COMPLETED')
      expect(JSON.stringify(recovery?.session.events)).not.toContain('private-source-command')
      expect(JSON.stringify(recovery?.session.events)).not.toContain('private-source-output')
      expect(JSON.stringify(recovery?.session.events)).not.toContain('private-source-error')

      const status = await ctx.commands.execute(recovery as Agent, '/postmortem-recovery', [], new AbortController().signal)
      expect(status?.result.text).toContain('"state": "completed"')
      expect(status?.result.text).toContain('"taskSuccess": "unverified"')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
