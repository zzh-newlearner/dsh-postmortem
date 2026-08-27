import type { Actionability, FindingCode } from './types.js'

export type AnnotationPrimaryIssue = FindingCode | 'none' | 'other' | 'cancelled'

export interface DiagnosisAnnotation {
  schemaVersion: '1'
  recordId: string
  reviewerId: string
  primaryIssue: AnnotationPrimaryIssue
  evidenceSteps: number[]
  actionability: Actionability
  notes?: string
}

export interface DiagnosisAdjudication {
  schemaVersion: '1'
  recordId: string
  adjudicatorId: string
  reviewerIds: [string, string]
  primaryIssue: AnnotationPrimaryIssue
  evidenceSteps: number[]
  actionability: Actionability
  notes?: string
}

export interface HumanReference {
  recordId: string
  source: 'human_agreement' | 'human_adjudication'
  primaryIssue: AnnotationPrimaryIssue
  evidenceSteps: number[]
  actionability: Actionability
}

export interface AnnotationIssue {
  recordId: string
  reason: string
}

export interface AnnotationSummary {
  references: HumanReference[]
  issues: AnnotationIssue[]
  doubleReviewedRecords: number
  exactAgreementRecords: number
  primaryIssueAgreement: number | undefined
  actionabilityAgreement: number | undefined
  evidenceStepAgreement: number | undefined
}

const PRIMARY_ISSUES = new Set<AnnotationPrimaryIssue>([
  'tool_error', 'retry_loop', 'missing_result', 'turn_failed', 'model_retry', 'none', 'other', 'cancelled',
])
const ACTIONABILITY = new Set<Actionability>([
  'actionable', 'partly_actionable', 'not_actionable', 'insufficient_evidence',
])

function validSteps(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(step => Number.isSafeInteger(step) && step >= 1)
}

function sameSteps(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((step, index) => step === right[index])
}

function normalizedSteps(steps: readonly number[]): number[] {
  return [...new Set(steps)].sort((left, right) => left - right)
}

/** Validate an annotation without accepting free-form content into runtime reports. */
export function validateDiagnosisAnnotation(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['annotation is not an object']
  const annotation = value as Partial<DiagnosisAnnotation>
  const issues: string[] = []
  if (annotation.schemaVersion !== '1') issues.push('unsupported annotation schema version')
  if (typeof annotation.recordId !== 'string' || annotation.recordId.trim().length === 0) issues.push('annotation record id is empty')
  if (typeof annotation.reviewerId !== 'string' || annotation.reviewerId.trim().length === 0) issues.push('annotation reviewer id is empty')
  if (!PRIMARY_ISSUES.has(annotation.primaryIssue as AnnotationPrimaryIssue)) issues.push('annotation primary issue is invalid')
  if (!validSteps(annotation.evidenceSteps) || normalizedSteps(annotation.evidenceSteps).length !== annotation.evidenceSteps.length) {
    issues.push('annotation evidence steps are invalid')
  }
  if (!ACTIONABILITY.has(annotation.actionability as Actionability)) issues.push('annotation actionability is invalid')
  if (annotation.notes !== undefined && (typeof annotation.notes !== 'string' || annotation.notes.length > 500)) {
    issues.push('annotation notes are invalid')
  }
  return issues
}

/** Validate an adjudication that resolves one exactly-two-reviewer disagreement. */
export function validateDiagnosisAdjudication(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['adjudication is not an object']
  const adjudication = value as Partial<DiagnosisAdjudication>
  const issues: string[] = []
  if (adjudication.schemaVersion !== '1') issues.push('unsupported adjudication schema version')
  if (typeof adjudication.recordId !== 'string' || adjudication.recordId.trim().length === 0) issues.push('adjudication record id is empty')
  if (typeof adjudication.adjudicatorId !== 'string' || adjudication.adjudicatorId.trim().length === 0) issues.push('adjudication adjudicator id is empty')
  if (!Array.isArray(adjudication.reviewerIds) || adjudication.reviewerIds.length !== 2
    || adjudication.reviewerIds.some(id => typeof id !== 'string' || id.trim().length === 0)
    || adjudication.reviewerIds[0] === adjudication.reviewerIds[1]) issues.push('adjudication reviewer ids are invalid')
  if (!PRIMARY_ISSUES.has(adjudication.primaryIssue as AnnotationPrimaryIssue)) issues.push('adjudication primary issue is invalid')
  if (!validSteps(adjudication.evidenceSteps) || normalizedSteps(adjudication.evidenceSteps).length !== adjudication.evidenceSteps.length) {
    issues.push('adjudication evidence steps are invalid')
  }
  if (!ACTIONABILITY.has(adjudication.actionability as Actionability)) issues.push('adjudication actionability is invalid')
  if (adjudication.notes !== undefined && (typeof adjudication.notes !== 'string' || adjudication.notes.length > 500)) {
    issues.push('adjudication notes are invalid')
  }
  return issues
}

/** Build model-quality references only from exact double-review agreement or a valid adjudication. */
export function summarizeAnnotations(
  annotations: readonly DiagnosisAnnotation[],
  adjudications: readonly DiagnosisAdjudication[] = [],
): AnnotationSummary {
  const issues: AnnotationIssue[] = []
  const groups = new Map<string, DiagnosisAnnotation[]>()
  for (const annotation of annotations) {
    const validation = validateDiagnosisAnnotation(annotation)
    if (validation.length > 0) {
      issues.push({ recordId: typeof annotation.recordId === 'string' ? annotation.recordId : 'unknown', reason: validation.join('; ') })
      continue
    }
    const values = groups.get(annotation.recordId) ?? []
    values.push({ ...annotation, evidenceSteps: normalizedSteps(annotation.evidenceSteps) })
    groups.set(annotation.recordId, values)
  }
  const validAdjudications = new Map<string, DiagnosisAdjudication>()
  for (const adjudication of adjudications) {
    const validation = validateDiagnosisAdjudication(adjudication)
    if (validation.length > 0 || validAdjudications.has(adjudication.recordId)) {
      issues.push({ recordId: typeof adjudication.recordId === 'string' ? adjudication.recordId : 'unknown', reason: validation.length > 0 ? validation.join('; ') : 'duplicate adjudication' })
      continue
    }
    validAdjudications.set(adjudication.recordId, { ...adjudication, evidenceSteps: normalizedSteps(adjudication.evidenceSteps) })
  }
  const references: HumanReference[] = []
  let doubleReviewedRecords = 0
  let exactAgreementRecords = 0
  let primaryMatches = 0
  let actionabilityMatches = 0
  let evidenceMatches = 0
  for (const [recordId, reviews] of groups) {
    const adjudication = validAdjudications.get(recordId)
    if (reviews.length !== 2 || reviews[0]?.reviewerId === reviews[1]?.reviewerId) {
      if (adjudication === undefined) issues.push({ recordId, reason: 'requires exactly two distinct reviewers or adjudication' })
      else references.push({ recordId, source: 'human_adjudication', primaryIssue: adjudication.primaryIssue, evidenceSteps: adjudication.evidenceSteps, actionability: adjudication.actionability })
      continue
    }
    doubleReviewedRecords += 1
    const [left, right] = reviews as [DiagnosisAnnotation, DiagnosisAnnotation]
    const primaryMatch = left.primaryIssue === right.primaryIssue
    const actionabilityMatch = left.actionability === right.actionability
    const evidenceMatch = sameSteps(left.evidenceSteps, right.evidenceSteps)
    if (primaryMatch) primaryMatches += 1
    if (actionabilityMatch) actionabilityMatches += 1
    if (evidenceMatch) evidenceMatches += 1
    if (adjudication !== undefined) {
      references.push({ recordId, source: 'human_adjudication', primaryIssue: adjudication.primaryIssue, evidenceSteps: adjudication.evidenceSteps, actionability: adjudication.actionability })
    } else if (primaryMatch && actionabilityMatch && evidenceMatch) {
      exactAgreementRecords += 1
      references.push({ recordId, source: 'human_agreement', primaryIssue: left.primaryIssue, evidenceSteps: left.evidenceSteps, actionability: left.actionability })
    } else {
      issues.push({ recordId, reason: 'reviewer disagreement requires adjudication' })
    }
  }
  for (const recordId of validAdjudications.keys()) {
    if (!groups.has(recordId)) issues.push({ recordId, reason: 'adjudication has no reviews' })
  }
  return {
    references: references.sort((left, right) => left.recordId.localeCompare(right.recordId)),
    issues,
    doubleReviewedRecords,
    exactAgreementRecords,
    primaryIssueAgreement: doubleReviewedRecords === 0 ? undefined : primaryMatches / doubleReviewedRecords,
    actionabilityAgreement: doubleReviewedRecords === 0 ? undefined : actionabilityMatches / doubleReviewedRecords,
    evidenceStepAgreement: doubleReviewedRecords === 0 ? undefined : evidenceMatches / doubleReviewedRecords,
  }
}
