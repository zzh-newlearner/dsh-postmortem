# DSH Postmortem

Local-first, read-only failure postmortems for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-postmortem` turns the existing DSH session event log into a short, redacted incident report. It does not alter the agent loop, retry a tool, inject a prompt, or upload a transcript. Optional model review is deliberately a second layer: deterministic findings are the authority, and invalid or unavailable model output is discarded.

## Install

```sh
npm install @huichangzz/dsh-postmortem
```

Add this to the DSH profile's `cordis.patch.yml`:

```yaml
- id: postmortem
  name: '@huichangzz/dsh-postmortem'
  config:
    autoOnFailure: true
    model:
      enabled: false
      provider: your-provider
      model: your-model
      timeoutMs: 10000
```

The plugin uses DSH's existing `llm` service. Configure model providers and keys in DSH, rather than this plugin; the package has no API-key setting and never writes a key.

## Commands

| Command | Result |
| --- | --- |
| `/postmortem [turn]` | Readable report for the latest or selected turn. |
| `/postmortem-export [turn]` | Redacted schema-v2 JSON report. |
| `/postmortem-repair [turn]` | Copy-only repair prompt for a detected failure. |

Commands use `recordInput: false`, so turn selection is not copied into `command/run` events. The repair command returns text only: it never calls a tool, submits a follow-up, retries an action, or makes itself model context.

## Detection And Privacy Boundary

The local rules detect tool error results, absent results after a closed turn, unchanged failed retries (three or more), and non-completed turn endings. An open turn stays inconclusive; it is not treated as a failed call simply because its result has not arrived yet.

Reports retain only turn number, tool name, opaque call ID, error code, step, and DSH event sequence numbers. They do not retain or export user messages, tool arguments, tool output, file contents, prompts, credentials, or a raw session trace. The in-memory cache contains those redacted reports only and disappears when DSH exits.

When `model.enabled` is true, the plugin sends at most four already-redacted findings to the configured DSH model with a 240-token cap and configured timeout. The response must be exactly this JSON shape:

```json
{
  "summary": "...",
  "immediateAction": "...",
  "evidenceSteps": [1],
  "confidence": "low"
}
```

Every accepted `evidenceSteps` item must identify a recorded finding. Any transport error, timeout, non-JSON output, extra key, missing key, unknown step, or invalid field makes `modelState` `failed`; the deterministic report remains available. Model review is explanatory, not a controller for retry or tool execution.

## Measuring Improvement

This package proves diagnostic behavior locally. It cannot honestly prove end-task success-rate uplift on its own because the runner, task corpus, model, and stop rule live outside the plugin.

Use `PairedRunRecord` and `evaluatePairs()` for an external runner's paired experiment. The published JSON Schema is [`schemas/paired-run-v1.schema.json`](schemas/paired-run-v1.schema.json). For every task, run exactly one matched `baseline` attempt and one `postmortem` attempt with the same task ID and `taskFingerprint`; `evaluatePairs()` excludes incomplete or mismatched pairs rather than silently comparing them.

Release gates for a task-success claim:

1. Pre-register the task source, task version/hash, model route, tool set, retry budget, timeout, and success oracle before running.
2. Collect at least 100 eligible matched pairs. Keep the correction arm to the copy-only prompt workflow; do not enable automatic retries.
3. Report baseline success rate, postmortem success rate, success-rate delta, paired wins/losses/ties, excluded-pair reasons, tool-call count, and elapsed time.
4. Claim an improvement only when postmortem success rises by at least 5 percentage points, paired wins exceed paired losses, and no material regression in safety checks, tool-call count, or elapsed time is observed. Otherwise report the result as inconclusive or negative.

Current repository acceptance checks are intentionally narrower and reproducible: 12 representative DSH event fixtures, three clean traces with no local finding, strict model-JSON validation or fallback, and one real `SessionStore + CommandRuntime + LlmRuntime` composition test. They establish correct plugin behavior, not an unmeasured task-success claim.

## Evaluation Data Sources

The package ships no external task corpus and makes no corpus download. Its 12 synthetic event fixtures are maintained in [`test/fixtures.ts`](test/fixtures.ts) and model DSH's public session event vocabulary. Any external paired evaluation must add its dataset source, version or commit hash, license/terms, acquisition date, task subset, and success oracle to its experiment report before results are compared.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The package targets DSH `0.1.0-rc.6` and Cordis `4.0.1`. DSH is in developer preview; the public session event vocabulary is this plugin's compatibility boundary.

## License

[MIT](LICENSE)
