import { createHash } from 'node:crypto'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

/** Hash structured, redacted metadata without retaining the original value. */
export function stableFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

/**
 * Produce a one-way, stable key for retry detection. Raw tool arguments never
 * enter a TurnTrace, cache, report, or model prompt.
 */
export function argumentFingerprint(argumentsText: string | undefined): string | undefined {
  if (argumentsText === undefined) return undefined
  let normalized = argumentsText
  try {
    normalized = canonicalJson(JSON.parse(argumentsText))
  } catch {
    // Invalid JSON is still comparable without exposing its original content.
  }
  return stableFingerprint(normalized)
}
