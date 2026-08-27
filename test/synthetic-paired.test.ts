import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { evaluatePairs, type PairedRunRecord } from '../src/evaluation.js'

const datasetDir = join(dirname(fileURLToPath(import.meta.url)), '../datasets/synthetic-paired-v1')

describe('synthetic paired evaluation fixture', () => {
  it('is explicitly synthetic and exercises wins, ties, and losses', async () => {
    const [manifestText, recordsText] = await Promise.all([
      readFile(join(datasetDir, 'manifest.json'), 'utf8'),
      readFile(join(datasetDir, 'records.jsonl'), 'utf8'),
    ])
    const manifest = JSON.parse(manifestText) as { recordCount: number, pairCount: number, origin: string, purpose: string }
    const records = recordsText.trim().split('\n').map(line => JSON.parse(line) as PairedRunRecord)
    const score = evaluatePairs(records)
    expect(manifest).toMatchObject({ recordCount: 16, pairCount: 8, origin: 'synthetic evaluation fixture' })
    expect(manifest.purpose).toContain('Not evidence')
    expect(score).toMatchObject({ eligiblePairs: 8, excludedPairs: 0, pairedWins: 4, pairedLosses: 1, ties: 3, successRateDelta: 0.375 })
  })
})
