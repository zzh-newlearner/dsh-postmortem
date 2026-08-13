import { describe, expect, it } from 'vitest'
import { turnFromEvents } from '../src/adapter.js'
import { diagnose } from '../src/diagnose.js'
import { dshFixtures } from './fixtures.js'

describe('DSH event fixtures', () => {
  it.each(dshFixtures)('$name projects deterministic findings', fixture => {
    const report = diagnose(turnFromEvents('fixture-session', fixture.turn, fixture.events))
    expect(report.decision).toBe(fixture.decision)
    expect(report.findings.map(finding => finding.code)).toEqual(expect.arrayContaining(fixture.codes))
    expect(report.findings.flatMap(finding => finding.eventSeqs).every(Number.isSafeInteger)).toBe(true)
  })

  it('contains twelve maintained representative event traces', () => {
    expect(dshFixtures).toHaveLength(12)
  })
})
