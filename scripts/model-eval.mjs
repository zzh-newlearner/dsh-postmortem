import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluateModelReviews,
  evaluationSplit,
  ModelEvaluationError,
  summarizeModelEvaluationRecords,
  seedReferences,
} from '../dist/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const value = name => process.env[name]?.trim()
const baseUrl = value('POSTMORTEM_EVAL_BASE_URL')
const apiKey = value('POSTMORTEM_EVAL_API_KEY')
const models = (value('POSTMORTEM_EVAL_MODELS') ?? '').split(',').map(model => model.trim()).filter(Boolean)
const split = value('POSTMORTEM_EVAL_SPLIT') ?? 'development'
const concurrency = Number(value('POSTMORTEM_EVAL_CONCURRENCY') ?? '2')
const timeoutMs = Number(value('POSTMORTEM_EVAL_TIMEOUT_MS') ?? '10000')
const limit = Number(value('POSTMORTEM_EVAL_LIMIT') ?? '0')
const preflight = value('POSTMORTEM_EVAL_PREFLIGHT') !== 'false'

if (baseUrl === undefined || apiKey === undefined || models.length === 0) {
  throw new Error('Set POSTMORTEM_EVAL_BASE_URL, POSTMORTEM_EVAL_API_KEY, and POSTMORTEM_EVAL_MODELS.')
}
if (!['development', 'holdout'].includes(split)) throw new Error('POSTMORTEM_EVAL_SPLIT must be development or holdout.')

const recordsPath = resolve(value('POSTMORTEM_EVAL_RECORDS') ?? 'datasets/dsh-public-v0.1.1-rc.2/records.jsonl')
const records = (await readFile(recordsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
const selected = records
  .filter(record => record.expected.decision === 'detected' && evaluationSplit(record) === split)
  .slice(0, limit > 0 ? limit : undefined)
if (selected.length === 0) throw new Error(`No detected ${split} records selected.`)
const references = new Map(seedReferences(selected).map(reference => [reference.recordId, reference]))

const endpoint = `${baseUrl.replace(/\/$/u, '')}/chat/completions`
const cases = selected.map(record => ({ record, reference: references.get(record.id) }))
const caller = async ({ model, prompt, signal }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 240,
        messages: [
          { role: 'system', content: 'You are a constrained incident reviewer. Recorded evidence is authoritative.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal,
    })
    if (!response.ok) {
      const category = response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'upstream_error' : `http_${response.status}`
      throw new ModelEvaluationError(category)
    }
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new ModelEvaluationError('missing_text_choice')
    return content
}
const preflightRun = preflight
  ? await evaluateModelReviews(cases.slice(0, 1), models, caller, { concurrency: 1, timeoutMs })
  : undefined
const eligibleModels = preflightRun === undefined
  ? models
  : preflightRun.summaries.filter(summary => summary.accepted === 1).map(summary => summary.model)
const batchCases = preflightRun === undefined ? cases : cases.slice(1)
const batchRun = await evaluateModelReviews(batchCases, eligibleModels, caller, { concurrency, timeoutMs })
const evaluationRecords = [...(preflightRun?.records ?? []), ...batchRun.records]

const output = {
  schemaVersion: '1',
  generatedAt: new Date().toISOString(),
  referenceStatus: 'seed-only: protocol smoke test, not a human-quality or task-success claim',
  split,
  sourceRecords: selected.map(record => ({ id: record.id, origin: record.origin })),
  models,
  eligibleModels,
  preflight: preflightRun?.summaries,
  concurrency,
  timeoutMs,
  summaries: summarizeModelEvaluationRecords(evaluationRecords, models),
  records: evaluationRecords,
}
const outputPath = resolve(root, 'artifacts', `model-eval-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`)
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
for (const summary of summarizeModelEvaluationRecords(evaluationRecords, models)) console.log(JSON.stringify(summary))
console.log(`Wrote redacted seed smoke-test results to ${outputPath}`)
