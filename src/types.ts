export type Severity = 'error' | 'warning'

export interface ToolCall {
  callId: string
  name: string
  /** Used only while diagnosing unchanged retries; never emitted in a report. */
  arguments?: string
  step: number
  callEventSeq?: number
  resultEventSeq?: number
  resultPresent: boolean
  isError: boolean
  errorCode?: string
}

export interface TurnTrace {
  sessionId: string
  turn: number
  ended: boolean
  endReason?: string
  endEventSeq?: number
  sourceSeq: number
  toolCalls: ToolCall[]
}

export type FindingCode = 'tool_error' | 'retry_loop' | 'missing_result' | 'turn_failed'

export interface Finding {
  code: FindingCode
  severity: Severity
  step: number
  title: string
  /** Session event sequence numbers supporting this finding. */
  eventSeqs: number[]
  /** Opaque identifiers only; raw tool input and output are intentionally absent. */
  evidence: string[]
  recommendation: string
}

export interface ModelReview {
  summary: string
  immediateAction: string
  evidenceSteps: number[]
  confidence: 'low' | 'medium' | 'high'
}

export type ModelState = 'disabled' | 'skipped_clean' | 'completed' | 'failed'

export interface PostmortemReport {
  schemaVersion: '2'
  sessionId: string
  turn: number
  /** Last session event included while producing this report. */
  sourceSeq: number
  decision: 'detected' | 'clean' | 'inconclusive'
  findings: Finding[]
  modelState: ModelState
  modelReview?: ModelReview
  /** Plain text only. The plugin never submits or executes this prompt. */
  repairPrompt?: string
}

export interface RecordedEvent {
  type: string
  seq?: number
  data: Record<string, unknown>
}
