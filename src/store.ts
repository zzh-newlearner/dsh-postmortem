import type { PostmortemReport } from './types.js'

function key(sessionId: string, turn: number): string {
  return `${sessionId}\u0000${turn}`
}

/** In-memory cache only. It stores redacted reports, never an event log or transcript. */
export class PostmortemStore {
  private readonly reports = new Map<string, PostmortemReport>()
  private readonly pending = new Map<string, Promise<PostmortemReport>>()

  get(sessionId: string, turn: number, sourceSeq: number): PostmortemReport | undefined {
    const report = this.reports.get(key(sessionId, turn))
    return report?.sourceSeq === sourceSeq ? report : undefined
  }

  latest(sessionId: string): PostmortemReport | undefined {
    return [...this.reports.values()]
      .filter(report => report.sessionId === sessionId)
      .sort((left, right) => right.turn - left.turn)[0]
  }

  set(report: PostmortemReport): PostmortemReport {
    const reportKey = key(report.sessionId, report.turn)
    const existing = this.reports.get(reportKey)
    if (existing !== undefined && existing.sourceSeq > report.sourceSeq) return existing
    this.reports.set(reportKey, report)
    return report
  }

  getPending(sessionId: string, turn: number, sourceSeq: number): Promise<PostmortemReport> | undefined {
    return this.pending.get(`${key(sessionId, turn)}\u0000${sourceSeq}`)
  }

  runPending(
    sessionId: string,
    turn: number,
    sourceSeq: number,
    operation: () => Promise<PostmortemReport>,
  ): Promise<PostmortemReport> {
    const pendingKey = `${key(sessionId, turn)}\u0000${sourceSeq}`
    const existing = this.pending.get(pendingKey)
    if (existing !== undefined) return existing
    const pending = operation().finally(() => this.pending.delete(pendingKey))
    this.pending.set(pendingKey, pending)
    return pending
  }
}
