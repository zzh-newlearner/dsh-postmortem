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
  /** Compatibility telemetry only; no event names or payloads are retained. */
  recognizedEventCount?: number
  unknownTurnEventCount?: number
  malformedEventCount?: number
}

export type FindingCode = 'tool_error' | 'retry_loop' | 'missing_result' | 'turn_failed' | 'model_retry' | 'compat_mismatch'
export type Actionability = 'actionable' | 'partly_actionable' | 'not_actionable' | 'insufficient_evidence'
export type PostmortemDecision = 'detected' | 'clean' | 'cancelled' | 'inconclusive'
export type InconclusiveReason = 'open_turn' | 'no_turn_events'

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

export type RepairActionKind =
  | 'check_resource'
  | 'check_permission'
  | 'check_external_state'
  | 'inspect_tool_arguments'
  | 'stop_unchanged_retry'
  | 'correct_credential'
  | 'wait_for_rate_limit'
  | 'reduce_context'
  | 'review_prior_findings'
  | 'check_compatibility'

export interface RepairAction {
  id: string
  findingCode: FindingCode
  step: number
  kind: RepairActionKind
  /** All actions are advisory; none are executed by this plugin. */
  execution: 'copy_only'
  action: string
  verification: string
}

/** A redacted, runner-neutral plan derived only from deterministic findings. */
export interface RepairPlan {
  schemaVersion: '1'
  sessionId: string
  turn: number
  sourceSeq: number
  actions: RepairAction[]
}

export type ModelState = 'disabled' | 'skipped_clean' | 'pending' | 'completed' | 'failed'

export interface PostmortemReport {
  schemaVersion: '2'
  sessionId: string
  turn: number
  /** Last session event included while producing this report. */
  sourceSeq: number
  decision: PostmortemDecision
  inconclusiveReason?: InconclusiveReason
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
