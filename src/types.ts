export type Severity = 'error' | 'warning'

export interface ToolCall {
  callId: string
  name: string
  arguments?: string
  result?: string
  isError: boolean
  errorCode?: string
}

export interface TurnTrace {
  sessionId: string
  turn: number
  ended: boolean
  endReason?: string
  toolCalls: ToolCall[]
}

export interface Finding {
  code: 'tool_error' | 'retry_loop' | 'missing_result' | 'turn_failed'
  severity: Severity
  step: number
  title: string
  evidence: string[]
  recommendation: string
}

export interface PostmortemReport {
  schemaVersion: '1'
  sessionId: string
  turn: number
  decision: 'detected' | 'clean' | 'inconclusive'
  findings: Finding[]
  modelExplanation?: string
  modelState?: 'disabled' | 'skipped_clean' | 'completed' | 'failed'
}

export interface RecordedEvent {
  type: string
  data: Record<string, unknown>
}
