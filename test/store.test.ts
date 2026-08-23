import { describe, expect, it } from 'vitest'
import { PostmortemStore } from '../src/store.js'
import type { PostmortemReport } from '../src/types.js'

const report = (sourceSeq: number): PostmortemReport => ({
  schemaVersion: '2', sessionId: 'session', turn: 1, sourceSeq, decision: 'detected', modelState: 'completed', findings: [],
})

describe('PostmortemStore', () => {
  it('coalesces concurrent model review work for the same trace', async () => {
    const store = new PostmortemStore()
    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = store.runPending('session', 1, 9, async () => {
      calls += 1
      await gate
      return report(9)
    })
    const second = store.runPending('session', 1, 9, async () => {
      calls += 1
      return report(9)
    })
    expect(calls).toBe(1)
    expect(second).toBe(first)
    release?.()
    await expect(first).resolves.toMatchObject({ sourceSeq: 9 })
    expect(store.getPending('session', 1, 9)).toBeUndefined()
  })

  it('does not let a slow older trace overwrite a newer report', () => {
    const store = new PostmortemStore()
    store.set(report(12))
    expect(store.set(report(9))).toMatchObject({ sourceSeq: 12 })
    expect(store.get('session', 1, 12)).toMatchObject({ sourceSeq: 12 })
  })
})
