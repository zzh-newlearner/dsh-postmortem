import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { repairPlanFingerprint } from '../src/repair.js'
import { buildRepairPlan } from '../src/repair.js'
import { diagnose } from '../src/diagnose.js'
import { evaluateVerifiedPairs, validateVerifiedPairedRunRecord, type VerifiedPairedRunRecord } from '../src/verified-evaluation.js'

const datasetDir = join(dirname(fileURLToPath(import.meta.url)), '../datasets/synthetic-verified-paired-v1')

describe('verified paired evaluation', () => {
  it('only counts pairs with a controlled setup and a repair intervention', async () => {
    const [manifestText, recordsText] = await Promise.all([
      readFile(join(datasetDir, 'manifest.json'), 'utf8'),
      readFile(join(datasetDir, 'records.jsonl'), 'utf8'),
    ])
    const manifest = JSON.parse(manifestText) as { recordCount: number, pairCount: number, purpose: string }
    const records = recordsText.trim().split('\n').map(line => JSON.parse(line) as VerifiedPairedRunRecord)
    const result = evaluateVerifiedPairs(records)
    expect(manifest).toMatchObject({ recordCount: 8, pairCount: 4 })
    expect(manifest.purpose).toContain('Not evidence')
    expect(result).toMatchObject({ eligiblePairs: 1, excludedPairs: 3, verifiedPairs: 1, successRateDelta: 1, pairedWins: 1 })
    expect(result.issues.map(issue => issue.reason)).toEqual(expect.arrayContaining([
      'environmentFingerprint differs between arms',
      expect.stringContaining('postmortem arm requires a repair-plan fingerprint'),
      'successCriterionFingerprint differs between arms',
    ]))
  })

  it('rejects a baseline that claims to have received a repair plan', () => {
    const invalid: VerifiedPairedRunRecord = {
      schemaVersion: '1', protocolId: 'p', pairId: 'pair', taskId: 'task', arm: 'baseline', success: false,
      taskFingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      environmentFingerprint: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      successCriterionFingerprint: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      intervention: 'repair_plan', repairPlanFingerprint: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', toolCalls: 1,
    }
    expect(validateVerifiedPairedRunRecord(invalid)).toContain('baseline arm must have no repair-plan intervention')
  })

  it('fingerprints a redacted repair plan deterministically', () => {
    const plan = buildRepairPlan(diagnose({
      sessionId: 'redacted', turn: 1, sourceSeq: 1, ended: true, endReason: 'error',
      toolCalls: [{ callId: 'opaque', name: 'shell', step: 1, isError: true, errorCode: 'ENOENT', resultPresent: true }],
    }))
    if (plan === undefined) throw new Error('expected repair plan')
    expect(repairPlanFingerprint(plan)).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(repairPlanFingerprint(plan)).toBe(repairPlanFingerprint(plan))
  })
})
