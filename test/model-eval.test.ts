import { describe, expect, it } from 'vitest'
import { ModelEvaluationError, evaluateModelReviews, seedReferences, summarizeModelEvaluationRecords } from '../src/model-eval.js'
import type { DiagnosisDatasetRecord } from '../src/dataset.js'

const record = (id: string): DiagnosisDatasetRecord => ({
  schemaVersion: '1', id,
  origin: { kind: 'dsh_schema_synthetic', repository: 'https://example.test', revision: 'schema-v2', license: 'MIT', acquiredAt: '2026-08-23' },
  sessionId: id, turn: 1,
  events: [
    { type: 'tool/call', data: { turn: 1, step: 1, callId: `${id}-call`, name: 'shell' } },
    { type: 'tool/result', data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: `${id}-call` }, content: [{ type: 'tool-result', isError: true }] } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } },
  ],
  expected: { decision: 'detected', findingCodes: ['tool_error', 'turn_failed'], labelStatus: 'seed' },
})

describe('model evaluation', () => {
  it('bounds global concurrency and records only valid structured reviews', async () => {
    const records = [record('one'), record('two')]
    const references = new Map(seedReferences(records).map(reference => [reference.recordId, reference]))
    let active = 0
    let peak = 0
    const run = await evaluateModelReviews(
      records.map(value => ({ record: value, reference: references.get(value.id) })),
      ['model-a', 'model-b', 'model-c', 'model-d'],
      async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 2))
        active -= 1
        return '{"findingCode":"tool_error","summary":"The tool returned an error.","immediateAction":"Inspect the tool preconditions.","evidenceSteps":[1],"confidence":"high","actionability":"actionable"}'
      },
      { concurrency: 2, timeoutMs: 100 },
    )
    expect(peak).toBeLessThanOrEqual(2)
    expect(run.records).toHaveLength(8)
    expect(run.records.every(value => value.status === 'accepted')).toBe(true)
    expect(run.summaries.every(value => value.validOutputRate === 1 && value.primaryIssueAccuracy === 1)).toBe(true)
    expect(summarizeModelEvaluationRecords(run.records, ['model-a'])[0]).toMatchObject({ attempts: 2, skipped: 0, accepted: 2 })
  })

  it('does not retain malformed model output', async () => {
    const value = record('invalid')
    const run = await evaluateModelReviews([{ record: value }], ['model'], async () => 'not json')
    expect(run.records[0]).toMatchObject({ status: 'invalid_output' })
    expect(run.records[0]?.review).toBeUndefined()
  })

  it('keeps only a stable failure category from a caller', async () => {
    const value = record('failed')
    const run = await evaluateModelReviews([{ record: value }], ['model'], async () => { throw new ModelEvaluationError('rate_limited') })
    expect(run.records[0]).toMatchObject({ status: 'failed', failureCode: 'rate_limited' })
  })

  it('opens a rate-limit circuit instead of spending requests after the first 429', async () => {
    const values = [record('one'), record('two'), record('three')]
    let calls = 0
    const run = await evaluateModelReviews(
      values.map(value => ({ record: value })),
      ['model'],
      async () => {
        calls += 1
        throw new ModelEvaluationError('rate_limited')
      },
      { concurrency: 1 },
    )
    expect(calls).toBe(1)
    expect(run.records.map(value => value.status)).toEqual(['failed', 'skipped', 'skipped'])
    expect(run.summaries[0]).toMatchObject({ attempts: 1, skipped: 2, accepted: 0 })
  })
})
