export type Severity = 'error' | 'warning'

export interface ToolCall {
  callId: string
  name: string
  /** One-way key used only while diagnosing unchanged retries. */
  argumentFingerprint?: string
  step: number
  callEventSeq?: number
  resultEventSeq?: number
  resultPresent: boolean
  isError: boolean
  errorCode?: string
}

/** Redacted status of one DSH provider retry that has been scheduled but not started. */
export interface PendingModelRetry {
  step: number
  retry: number
  delayMs: number
  mode: 'normal' | 'always'
  maxRetries?: number
  errorCode?: string
  eventSeq?: number
}

export interface TurnTrace {
  sessionId: string
  turn: number
  ended: boolean
  endReason?: string
  endErrorCode?: string
  endAbortCause?: string
  endEventSeq?: number
  sourceSeq: number
  toolCalls: ToolCall[]
  pendingModelRetry?: PendingModelRetry
}

export type FindingCode = 'tool_error' | 'retry_loop' | 'missing_result' | 'turn_failed' | 'model_retry'
export type Actionability = 'actionable' | 'partly_actionable' | 'not_actionable' | 'insufficient_evidence'
export type PostmortemDecision = 'detected' | 'clean' | 'cancelled' | 'inconclusive'

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
  findingCode: FindingCode
  summary: string
  immediateAction: string
  evidenceSteps: number[]
  confidence: 'low' | 'medium' | 'high'
  actionability: Actionability
}

export type ModelState = 'disabled' | 'skipped_clean' | 'pending' | 'completed' | 'failed'

export interface PostmortemReport {
  schemaVersion: '2'
  sessionId: string
  turn: number
  /** Last session event included while producing this report. */
  sourceSeq: number
  decision: PostmortemDecision
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
