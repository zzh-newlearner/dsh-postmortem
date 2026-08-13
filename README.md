# DSH Postmortem

Local-first failure postmortems for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-postmortem` observes the session event log and explains failed turns without changing
the agent, its tools, or its retry behavior. The default path is deterministic and local. An
optional model review explains only a small, redacted evidence packet after a rule has fired.

## Install

In a DSH profile directory, install the package:

```sh
npm install @zzh-newlearner/dsh-postmortem
```

Add the following entry to the profile's `cordis.patch.yml`:

```yaml
- id: postmortem
  name: '@zzh-newlearner/dsh-postmortem'
  config:
    autoOnFailure: true
    model:
      enabled: false
      provider: deepseek-official
      model: deepseek-v4-flash
      timeoutMs: 10000
```

Restart DSH, then enter `/postmortem` in a session to inspect its most recent turn. The
command is read-only and never becomes model context.

For a copyable config, see [examples/postmortem.cordis.patch.yml](examples/postmortem.cordis.patch.yml).

## What It Detects

- Tool calls with a recorded error result.
- Three or more unchanged tool calls that all fail or lack results.
- Calls with no recorded result, which may indicate cancellation or timeout.
- A turn that ended with a non-success reason.

These are recorded observations, not claims of a unique root cause. A normal completed turn
is reported as clean; an open turn is inconclusive.

## Optional Model Review

Set `model.enabled: true` to ask the configured DSH model for a concise explanation and one
recovery action. The plugin sends only the top deterministic findings: finding code, step,
tool/error identifiers, and recommendations. It does not send user messages, raw tool
arguments, raw tool output, files, prompts, or credentials.

The model has a 300-token response cap and the configured timeout. A timeout, transport error,
or empty response leaves the deterministic report intact and marks model review as failed.

## Privacy

The plugin does not export telemetry, write a transcript, or make any network request unless
optional model review is enabled. Reports contain tool names, opaque call IDs, error codes, and
counts by default. DSH and its model provider own any request logging after model review is
enabled.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The package targets DSH `0.1.0-rc.6` and Cordis `4.0.1`. DSH is in developer preview; this
plugin treats the public session event vocabulary as its compatibility boundary.

## License

[MIT](LICENSE)
