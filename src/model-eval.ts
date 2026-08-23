import { turnFromEvents } from './adapter.js'
import type { AnnotationPrimaryIssue, HumanReference } from './annotations.js'
import type { DiagnosisDatasetRecord } from './dataset.js'
import { diagnose } from './diagnose.js'
import { parseModelReview, reviewPrompt } from './explain.js'
import type { Actionability, ModelReview } from './types.js'

export interface ModelEvaluationReference {
  recordId: string
  source: 'seed' | 'human_agreement' | 'human_adjudication'
  primaryIssue: AnnotationPrimaryIssue
  evidenceSteps: number[]
  actionability?: Actionability
}

export interface ModelEvaluationCase {
  record: DiagnosisDatasetRecord
  reference?: ModelEvaluationReference
}

export interface ModelEvaluationRequest {
  model: string
  prompt: string
  signal: AbortSignal
}

export type ModelEvaluationCaller = (request: ModelEvaluationRequest) => Promise<string>

/** A caller may expose a stable, non-sensitive transport category for benchmarking. */
export class ModelEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export interface ModelEvaluationOptions {
  concurrency?: number
  timeoutMs?: number
}

export interface ModelEvaluationRecord {
  model: string
  recordId: string
  referenceSource?: ModelEvaluationReference['source']
  durationMs: number
  status: 'accepted' | 'invalid_output' | 'timed_out' | 'failed' | 'skipped'
  failureCode?: string
  review?: ModelReview
  primaryIssueMatch?: boolean
  evidenceStepMatch?: boolean
  actionabilityMatch?: boolean
}

export interface ModelEvaluationSummary {
  model: string
  attempts: number
  skipped: number
  accepted: number
  validOutputRate: number
  referencedCases: number
  primaryIssueAccuracy?: number
  evidenceStepAccuracy?: number
  actionabilityAccuracy?: number
  p50LatencyMs?: number
  p95LatencyMs?: number
}

export interface ModelEvaluationRun {
  records: ModelEvaluationRecord[]
  summaries: ModelEvaluationSummary[]
}

// A small global default is more useful than a burst that exhausts a shared provider quota.
const DEFAULT_EVAL_CONCURRENCY = 2
const DEFAULT_EVAL_TIMEOUT_MS = 10_000

function sameSteps(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((step, index) => step === right[index])
}

function rate(numerator: number, denominator: number): number | undefined {
  return denominator === 0 ? undefined : numerator / denominator
}

function percentile(values: readonly number[], proportion: number): number | undefined {
  if (values.length === 0) return undefined
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * proportion) - 1)]
}

/** Turn curated seed labels into explicitly non-human references for protocol smoke tests only. */
export function seedReferences(records: readonly DiagnosisDatasetRecord[]): ModelEvaluationReference[] {
  return records.map(record => {
    const report = diagnose(turnFromEvents(record.sessionId, record.turn, record.events))
    const primaryIssue = record.expected.findingCodes[0] ?? 'none'
    const evidenceSteps = report.findings.find(finding => finding.code === primaryIssue)?.step
    return {
      recordId: record.id,
      source: 'seed',
      primaryIssue,
      evidenceSteps: evidenceSteps === undefined ? [] : [evidenceSteps],
    }
  })
}

export function humanReferences(references: readonly HumanReference[]): ModelEvaluationReference[] {
  return references.map(reference => ({
    recordId: reference.recordId,
    source: reference.source,
    primaryIssue: reference.primaryIssue,
    evidenceSteps: reference.evidenceSteps,
    actionability: reference.actionability,
  }))
}

/** Recompute comparable per-model metrics after combining preflight and batch records. */
export function summarizeModelEvaluationRecords(
  records: readonly ModelEvaluationRecord[],
  models: readonly string[],
): ModelEvaluationSummary[] {
  return models.map(model => {
    const modelRecords = records.filter(record => record.model === model)
    const attempted = modelRecords.filter(record => record.status !== 'skipped')
    const accepted = modelRecords.filter(record => record.status === 'accepted')
    const primary = accepted.filter(record => record.primaryIssueMatch !== undefined)
    const evidence = accepted.filter(record => record.evidenceStepMatch !== undefined)
    const actionability = accepted.filter(record => record.actionabilityMatch !== undefined)
    return {
      model,
      attempts: attempted.length,
      skipped: modelRecords.length - attempted.length,
      accepted: accepted.length,
      validOutputRate: accepted.length / Math.max(1, attempted.length),
      referencedCases: accepted.filter(record => record.referenceSource !== undefined).length,
      primaryIssueAccuracy: rate(primary.filter(record => record.primaryIssueMatch).length, primary.length),
      evidenceStepAccuracy: rate(evidence.filter(record => record.evidenceStepMatch).length, evidence.length),
      actionabilityAccuracy: rate(actionability.filter(record => record.actionabilityMatch).length, actionability.length),
      p50LatencyMs: percentile(accepted.map(record => record.durationMs), 0.5),
      p95LatencyMs: percentile(accepted.map(record => record.durationMs), 0.95),
    }
  })
}

/** Execute redacted-review protocol calls with a bounded global concurrency. */
export async function evaluateModelReviews(
  cases: readonly ModelEvaluationCase[],
  models: readonly string[],
  caller: ModelEvaluationCaller,
  options: ModelEvaluationOptions = {},
): Promise<ModelEvaluationRun> {
  const concurrency = options.concurrency ?? DEFAULT_EVAL_CONCURRENCY
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('model evaluation concurrency must be a positive integer')
  const timeoutMs = options.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('model evaluation timeout must be a positive integer')
  // Round-robin models by case so a shared endpoint cannot starve later models.
  const work = cases.flatMap(value => models.map(model => ({ model, value })))
  const results: ModelEvaluationRecord[] = []
  let next = 0
  let rateLimitCircuitOpen = false
  const runOne = async (model: string, value: ModelEvaluationCase): Promise<ModelEvaluationRecord> => {
    const report = diagnose(turnFromEvents(value.record.sessionId, value.record.turn, value.record.events))
    const startedAt = performance.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const text = await caller({ model, prompt: reviewPrompt(report), signal: controller.signal })
      const review = parseModelReview(text, report.findings.map(finding => finding.step), report.findings.map(finding => finding.code))
      const durationMs = performance.now() - startedAt
      if (review === undefined) return { model, recordId: value.record.id, referenceSource: value.reference?.source, durationMs, status: 'invalid_output' }
      const reference = value.reference
      const primaryIssueMatch = reference === undefined || !report.findings.some(finding => finding.code === reference.primaryIssue)
        ? undefined
        : review.findingCode === reference.primaryIssue
      const evidenceStepMatch = reference === undefined ? undefined : sameSteps(review.evidenceSteps, reference.evidenceSteps)
      const actionabilityMatch = reference?.actionability === undefined ? undefined : review.actionability === reference.actionability
      return { model, recordId: value.record.id, referenceSource: reference?.source, durationMs, status: 'accepted', review, primaryIssueMatch, evidenceStepMatch, actionabilityMatch }
    } catch (error: unknown) {
      return {
        model,
        recordId: value.record.id,
        referenceSource: value.reference?.source,
        durationMs: performance.now() - startedAt,
        status: controller.signal.aborted ? 'timed_out' : 'failed',
        ...(controller.signal.aborted ? {} : error instanceof ModelEvaluationError ? { failureCode: error.code } : { failureCode: 'request_failed' }),
      }
    } finally {
      clearTimeout(timer)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (true) {
      const position = next
      next += 1
      const item = work[position]
      if (item === undefined) return
      if (rateLimitCircuitOpen) {
        results.push({
          model: item.model,
          recordId: item.value.record.id,
          referenceSource: item.value.reference?.source,
          durationMs: 0,
          status: 'skipped',
          failureCode: 'rate_limited',
        })
        continue
      }
      const result = await runOne(item.model, item.value)
      results.push(result)
      if (result.failureCode === 'rate_limited') rateLimitCircuitOpen = true
    }
  })
  await Promise.all(workers)
  const records = results.sort((left, right) => left.model.localeCompare(right.model) || left.recordId.localeCompare(right.recordId))
  return { records, summaries: summarizeModelEvaluationRecords(records, models) }
}
