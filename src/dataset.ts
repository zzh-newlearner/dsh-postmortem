import { turnFromEvents } from './adapter.js'
import { diagnose } from './diagnose.js'
import type { FindingCode, PostmortemDecision, RecordedEvent } from './types.js'
import { createHash } from 'node:crypto'

export type DatasetOriginKind = 'dsh_public_fixture' | 'dsh_schema_synthetic'

export interface DatasetOrigin {
  kind: DatasetOriginKind
  repository: string
  revision: string
  path?: string
  license: string
  acquiredAt: string
}

export interface DatasetExpectation {
  decision: PostmortemDecision
  findingCodes: FindingCode[]
  /** Event facts are curated but have not yet received independent human adjudication. */
  labelStatus: 'seed'
}

export interface DiagnosisDatasetRecord {
  schemaVersion: '1'
  id: string
  origin: DatasetOrigin
  sessionId: string
  turn: number
  events: RecordedEvent[]
  expected: DatasetExpectation
}

export interface DiagnosisCorpusScore {
  records: number
  decisionMatches: number
  exactCodeMatches: number
  codePrecision: number
  codeRecall: number
  codeF1: number
}

export type EvaluationSplit = 'development' | 'holdout'

const ALLOWED_EVENT_TYPES = new Set(['tool/call', 'tool/result', 'turn/end'])

/** Stable record-id partition; adding new records never moves an existing record. */
export function evaluationSplit(record: Pick<DiagnosisDatasetRecord, 'id'>): EvaluationSplit {
  const digest = createHash('sha256').update(record.id).digest()[0]
  return digest !== undefined && digest % 5 === 0 ? 'holdout' : 'development'
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function validateRedactedEvent(event: RecordedEvent, publicFixture: boolean): string[] {
  const issues: string[] = []
  if (event.type === 'tool/call') {
    const allowed = publicFixture
      ? ['turn', 'step', 'callId', 'name']
      : ['turn', 'step', 'callId', 'name', 'arguments']
    if (!hasOnlyKeys(event.data, allowed)) issues.push('tool call contains a non-redacted field')
  }
  if (event.type === 'tool/result') {
    if (!hasOnlyKeys(event.data, ['turn', 'step', 'message', 'error'])) {
      issues.push('tool result contains a non-redacted field')
    }
    const message = event.data.message
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      issues.push('tool result has no redacted message envelope')
      return issues
    }
    const messageValue = message as Record<string, unknown>
    if (!hasOnlyKeys(messageValue, ['source', 'content'])) issues.push('tool result message contains a non-redacted field')
    const source = messageValue.source
    if (typeof source !== 'object' || source === null || Array.isArray(source)
      || !hasOnlyKeys(source as Record<string, unknown>, ['kind', 'callId'])) {
      issues.push('tool result source contains a non-redacted field')
    }
    const content = messageValue.content
    const block = Array.isArray(content) ? content[0] : undefined
    if (typeof block !== 'object' || block === null || Array.isArray(block)
      || !hasOnlyKeys(block as Record<string, unknown>, ['type', 'isError'])) {
      issues.push('tool result retains content or lacks result state')
    }
    const error = event.data.error
    if (error !== undefined && (typeof error !== 'object' || error === null || Array.isArray(error)
      || !hasOnlyKeys(error as Record<string, unknown>, ['code']))) {
      issues.push('tool result error contains a non-redacted field')
    }
  }
  if (event.type === 'turn/end') {
    if (!hasOnlyKeys(event.data, ['turn', 'reason'])) issues.push('turn end contains a non-redacted field')
    const reason = event.data.reason
    if (typeof reason !== 'object' || reason === null || Array.isArray(reason)
      || !hasOnlyKeys(reason as Record<string, unknown>, ['kind', 'error', 'reason'])) {
      issues.push('turn end reason contains a non-redacted field')
    }
    const abortCause = (reason as Record<string, unknown> | undefined)?.reason
    if (abortCause !== undefined && (typeof abortCause !== 'object' || abortCause === null || Array.isArray(abortCause)
      || !hasOnlyKeys(abortCause as Record<string, unknown>, ['kind']))) {
      issues.push('turn end abort cause contains a non-redacted field')
    }
    const error = (reason as Record<string, unknown> | undefined)?.error
    if (error !== undefined && (typeof error !== 'object' || error === null || Array.isArray(error)
      || !hasOnlyKeys(error as Record<string, unknown>, ['code']))) {
      issues.push('turn end error contains a non-redacted field')
    }
  }
  return issues
}

/** Return stable, non-sensitive dataset validation failures for a candidate record. */
export function validateDiagnosisDatasetRecord(record: DiagnosisDatasetRecord): string[] {
  const issues: string[] = []
  if (record.schemaVersion !== '1') issues.push('unsupported schema version')
  if (record.id.trim().length === 0) issues.push('record id is empty')
  if (record.origin.license !== 'MIT') issues.push('record license is not declared as MIT')
  if (record.origin.kind === 'dsh_public_fixture' && (record.origin.path?.trim().length ?? 0) === 0) {
    issues.push('public DSH fixture has no source path')
  }
  if (record.expected.labelStatus !== 'seed') issues.push('record label status is not seed')
  for (const event of record.events) {
    if (!ALLOWED_EVENT_TYPES.has(event.type)) issues.push(`unsupported event type ${event.type}`)
    issues.push(...validateRedactedEvent(event, record.origin.kind === 'dsh_public_fixture'))
  }
  return issues
}

/** Score deterministic findings against the corpus's curated event-fact labels. */
export function scoreDiagnosisCorpus(records: readonly DiagnosisDatasetRecord[]): DiagnosisCorpusScore {
  let decisionMatches = 0
  let exactCodeMatches = 0
  let truePositives = 0
  let falsePositives = 0
  let falseNegatives = 0
  for (const record of records) {
    const report = diagnose(turnFromEvents(record.sessionId, record.turn, record.events))
    if (report.decision === record.expected.decision) decisionMatches += 1
    const actual = new Set(report.findings.map(finding => finding.code))
    const expected = new Set(record.expected.findingCodes)
    if (actual.size === expected.size && [...actual].every(code => expected.has(code))) exactCodeMatches += 1
    for (const code of actual) {
      if (expected.has(code)) truePositives += 1
      else falsePositives += 1
    }
    for (const code of expected) if (!actual.has(code)) falseNegatives += 1
  }
  const codePrecision = truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives)
  const codeRecall = truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives)
  return {
    records: records.length,
    decisionMatches,
    exactCodeMatches,
    codePrecision,
    codeRecall,
    codeF1: codePrecision + codeRecall === 0 ? 0 : 2 * codePrecision * codeRecall / (codePrecision + codeRecall),
  }
}
