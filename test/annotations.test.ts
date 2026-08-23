import { describe, expect, it } from 'vitest'
import { summarizeAnnotations, validateDiagnosisAdjudication, validateDiagnosisAnnotation } from '../src/annotations.js'
import type { Actionability } from '../src/types.js'
import type { AnnotationPrimaryIssue, DiagnosisAnnotation } from '../src/annotations.js'

const review = (
  reviewerId: string,
  primaryIssue: AnnotationPrimaryIssue = 'tool_error',
  actionability: Actionability = 'actionable',
  evidenceSteps = [2],
): DiagnosisAnnotation => ({
  schemaVersion: '1' as const, recordId: 'record-1', reviewerId, primaryIssue, actionability, evidenceSteps,
})

describe('human annotation aggregation', () => {
  it('accepts exact double-review agreement as a human reference', () => {
    const summary = summarizeAnnotations([review('reviewer-a'), review('reviewer-b')])
    expect(summary.references).toEqual([{
      recordId: 'record-1', source: 'human_agreement', primaryIssue: 'tool_error', actionability: 'actionable', evidenceSteps: [2],
    }])
    expect(summary.primaryIssueAgreement).toBe(1)
  })

  it('requires adjudication for disagreement and accepts a valid resolution', () => {
    const annotations = [review('reviewer-a'), review('reviewer-b', 'turn_failed')]
    expect(summarizeAnnotations(annotations).issues).toContainEqual({ recordId: 'record-1', reason: 'reviewer disagreement requires adjudication' })
    const adjudication = {
      schemaVersion: '1' as const, recordId: 'record-1', adjudicatorId: 'adjudicator', reviewerIds: ['reviewer-a', 'reviewer-b'] as [string, string],
      primaryIssue: 'tool_error' as const, evidenceSteps: [2], actionability: 'actionable' as const,
    }
    expect(validateDiagnosisAnnotation(review('reviewer-a'))).toEqual([])
    expect(validateDiagnosisAdjudication(adjudication)).toEqual([])
    expect(summarizeAnnotations(annotations, [adjudication]).references[0]?.source).toBe('human_adjudication')
  })
})
