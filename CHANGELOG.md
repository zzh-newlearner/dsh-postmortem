# Changelog

## 0.6.2

- Publishes the plugin as a DSH bundle with its own Loader patch, so `dsh plugin --profile <name> add @huichangzz/dsh-postmortem` installs and registers it in one step.
- Corrects the install guide: profile patches override the bundled defaults only when optional model review is enabled.

## 0.6.1

- Adds a runnable DSH command-path self-check that exercises the built package through `Context`, `SessionStore`, `CommandRuntime`, and `LlmRuntime`.
- Verifies report, export, repair, redaction, and the no-injection boundary against one redacted failed turn.

## 0.6.0

- Reframes the bilingual README around a 60-second install path, real redacted command output, and explicit recovery value.
- Adds a runnable redacted demo, npm discovery metadata, and a privacy-safe issue template for external feedback.

## 0.5.0

- Adds cancellation-aware diagnosis, one-way normalized tool-argument fingerprints, bounded model timeouts, and trace-level model-review coalescing.
- Adds 24 versioned, source-traceable redacted DSH seed records, including stable development/holdout partitioning.
- Adds double-review annotation aggregation, adjudication support, and a bounded parallel OpenAI-compatible model evaluation runner.
- Adds a generic `npm run eval:models` protocol smoke test that writes redacted, ignored artifacts only.

## 0.4.1

- Fixes the DSH `0.1.1-rc.2` composition test for the current command attachment parameter.

## 0.4.0

- Adds a versioned, redacted 16-record DSH seed corpus with source paths, revision, license, and acquisition date.
- Scores deterministic diagnosis against curated event-fact labels without presenting seed labels as benchmark results.
- Retains DSH terminal error codes from `turn/end` without retaining error messages.
- Updates the DSH compatibility target to `0.1.1-rc.2`.

## 0.3.0

- Adds per-session, per-turn in-memory report caching and historical turn commands.
- Adds constrained JSON model review with validation and deterministic fallback.
- Adds a copy-only repair prompt; it never retries, injects context, or calls a tool.
- Adds a runner-neutral paired evaluation contract for measuring task-success change.
- Adds twelve DSH event fixtures and a real DSH service composition test.
