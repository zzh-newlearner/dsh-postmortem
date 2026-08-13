import type { PostmortemReport } from './types.js'

function key(sessionId: string, turn: number): string {
  return `${sessionId}\u0000${turn}`
}

/** In-memory cache only. It stores redacted reports, never an event log or transcript. */
export class PostmortemStore {
  private readonly reports = new Map<string, PostmortemReport>()

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
    this.reports.set(key(report.sessionId, report.turn), report)
    return report
  }
}
