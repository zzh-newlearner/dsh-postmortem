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
export function argumentFingerprint(argumentsValue: unknown): string | undefined {
  if (argumentsValue === undefined) return undefined
  let normalized = argumentsValue
  if (typeof argumentsValue === 'string') {
    try {
      normalized = JSON.parse(argumentsValue)
    } catch {
      // Invalid JSON is still comparable without exposing its original content.
    }
  }
  return stableFingerprint(normalized)
}

const PRESENTATION_KEYS = new Set([
  'commentary', 'description', 'explanation', 'rationale', 'reasoning', 'summary', 'thought',
])

function parsedArguments(argumentsValue: unknown): unknown {
  if (typeof argumentsValue !== 'string') return argumentsValue
  try {
    return JSON.parse(argumentsValue)
  } catch {
    return argumentsValue
  }
}

function removePresentationFields(value: unknown): unknown | undefined {
  if (Array.isArray(value)) {
    const values = value.map(removePresentationFields).filter((item): item is unknown => item !== undefined)
    return values.length === 0 ? undefined : values
  }
  if (value === null || typeof value !== 'object') return value
  const retained = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !PRESENTATION_KEYS.has(key.toLowerCase()))
    .map(([key, item]) => [key, removePresentationFields(item)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)
  return retained.length === 0 ? undefined : Object.fromEntries(retained)
}

/**
 * Fingerprint the executable part of a call for retry detection. Presentation
 * text is intentionally excluded: headless providers often regenerate it on
 * each retry. A call containing only presentation text has no retry key.
 */
export function retryFingerprint(argumentsValue: unknown): string | undefined {
  if (argumentsValue === undefined) return undefined
  const executable = removePresentationFields(parsedArguments(argumentsValue))
  return executable === undefined ? undefined : stableFingerprint(executable)
}
