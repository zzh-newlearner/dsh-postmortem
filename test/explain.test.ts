import { describe, expect, it } from 'vitest'
import { explainWithModel, parseModelReview, reviewPrompt } from '../src/explain.js'
import type { PostmortemReport } from '../src/types.js'

const report: PostmortemReport = {
  schemaVersion: '2', sessionId: 's1', turn: 2, sourceSeq: 9, decision: 'detected', modelState: 'disabled',
  findings: [{ code: 'tool_error', severity: 'error', step: 2, title: 'Tool shell failed', eventSeqs: [4, 5], evidence: ['tool=shell, call=c1', 'error_code=ENOENT'], recommendation: 'Check the path.' }],
}

describe('model review boundary', () => {
  it('accepts the exact JSON contract with recorded steps only', () => {
    expect(parseModelReview('{"summary":"Path is unavailable.","immediateAction":"Verify the path before retrying.","evidenceSteps":[2],"confidence":"high"}', [2]))
      .toMatchObject({ confidence: 'high', evidenceSteps: [2] })
  })

  it('rejects markdown, extra fields, and invented evidence steps', () => {
    expect(parseModelReview('```json {} ```', [2])).toBeUndefined()
    expect(parseModelReview('{"summary":"x","immediateAction":"y","evidenceSteps":[2],"confidence":"low","cause":"invented"}', [2])).toBeUndefined()
    expect(parseModelReview('{"summary":"x","immediateAction":"y","evidenceSteps":[3],"confidence":"low"}', [2])).toBeUndefined()
  })

  it('builds a prompt without session id, arguments, or output', () => {
    const prompt = reviewPrompt(report)
    expect(prompt).not.toContain('s1')
    expect(prompt).not.toContain('{"cmd":"x"}')
    expect(prompt).toContain('error_code=ENOENT')
  })

  it('accepts valid streamed JSON without increasing the response budget', async () => {
    let requestedMaxTokens = 0
    const llm = {
      async *stream(request: { maxTokens?: number }) {
        requestedMaxTokens = request.maxTokens ?? 0
        yield { type: 'block-start', index: 0, blockType: 'text' } as const
        yield { type: 'text-delta', index: 0, text: '{"summary":"Missing executable.","immediateAction":"Check the path.","evidenceSteps":[2],"confidence":"medium"}' } as const
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"summary":"Missing executable.","immediateAction":"Check the path.","evidenceSteps":[2],"confidence":"medium"}' } } as const
      },
    }
    const review = await explainWithModel(llm as never, report, { provider: 'test', model: 'test' })
    expect(review.confidence).toBe('medium')
    expect(requestedMaxTokens).toBe(240)
  })
})
