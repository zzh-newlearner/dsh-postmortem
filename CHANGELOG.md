# Changelog

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
