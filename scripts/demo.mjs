import { buildRepairPrompt, diagnose, formatReport, turnFromEvents } from '../dist/index.js'

// A redacted DSH-shaped trace. It contains no user content or tool output.
const events = [
  { type: 'turn/start', seq: 1, data: { turn: 1 } },
  { type: 'tool/call', seq: 2, data: { turn: 1, step: 1, callId: 'demo-shell-01', name: 'shell', arguments: '{"cmd":"private-command"}' } },
  {
    type: 'tool/result', seq: 3, data: {
      turn: 1,
      step: 1,
      message: { source: { kind: 'tool', callId: 'demo-shell-01' }, content: [{ type: 'tool-result', isError: true }] },
      error: { name: 'ToolError', code: 'ENOENT' },
    },
  },
  { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN' } } } },
]

const report = diagnose(turnFromEvents('demo-session', 1, events))
console.log(formatReport(report))
console.log('\n--- Copy-only repair prompt ---\n')
console.log(buildRepairPrompt(report))
