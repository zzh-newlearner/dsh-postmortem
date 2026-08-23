import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scoreDiagnosisCorpus, validateDiagnosisDatasetRecord, type DiagnosisDatasetRecord } from '../src/dataset.js'

const datasetDir = join(dirname(fileURLToPath(import.meta.url)), '../datasets/dsh-public-v0.1.1-rc.2')

async function readCorpus(): Promise<DiagnosisDatasetRecord[]> {
  const content = await readFile(join(datasetDir, 'records.jsonl'), 'utf8')
  return content.trim().split('\n').map(line => JSON.parse(line) as DiagnosisDatasetRecord)
}

async function readManifest(): Promise<{ recordCount: number, sourceRevision: string }> {
  const content = await readFile(join(datasetDir, 'manifest.json'), 'utf8')
  return JSON.parse(content) as { recordCount: number, sourceRevision: string }
}

describe('public DSH seed corpus', () => {
  it('is traceable, redacted, and stable under deterministic diagnosis', async () => {
    const records = await readCorpus()
    const manifest = await readManifest()
    const score = scoreDiagnosisCorpus(records)
    expect(records).toHaveLength(16)
    expect(manifest).toMatchObject({ recordCount: 16, sourceRevision: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' })
    expect(new Set(records.map(record => record.id)).size).toBe(records.length)
    expect(records.filter(record => record.origin.kind === 'dsh_public_fixture')).toHaveLength(7)
    expect(records.every(record => record.origin.license === 'MIT' && record.expected.labelStatus === 'seed')).toBe(true)
    expect(records.flatMap(validateDiagnosisDatasetRecord)).toEqual([])
    expect(JSON.stringify(records)).not.toMatch(/DEEPSEEK_API_KEY|sk-|ghp_|private output/i)
    expect(JSON.stringify(records.filter(record => record.origin.kind === 'dsh_public_fixture'))).not.toMatch(/"arguments"|"text"|"path":"[A-Z]:/i)
    expect(score).toMatchObject({ records: 16, decisionMatches: 16, exactCodeMatches: 16, codePrecision: 1, codeRecall: 1, codeF1: 1 })
  })

  it('rejects retained content and missing public provenance', async () => {
    const [record] = await readCorpus()
    if (record === undefined) throw new Error('seed corpus is empty')
    expect(validateDiagnosisDatasetRecord({
      ...record,
      events: [{ type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'shell', arguments: '{"private":"value"}' } }],
    })).toContain('tool call contains a non-redacted field')
    expect(validateDiagnosisDatasetRecord({
      ...record,
      events: [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'error', message: 'private value' } } }],
    })).toContain('turn end reason contains a non-redacted field')
    expect(validateDiagnosisDatasetRecord({ ...record, origin: { ...record.origin, path: undefined } })).toContain('public DSH fixture has no source path')
  })
})
