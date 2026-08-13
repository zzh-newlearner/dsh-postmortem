# Changelog

## 0.3.0

- Adds per-session, per-turn in-memory report caching and historical turn commands.
- Adds constrained JSON model review with validation and deterministic fallback.
- Adds a copy-only repair prompt; it never retries, injects context, or calls a tool.
- Adds a runner-neutral paired evaluation contract for measuring task-success change.
- Adds twelve DSH event fixtures and a real DSH service composition test.
