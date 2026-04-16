# ADR 0006: Session-scoped visibility

- Status: Accepted
- Date: 2026-04-15

## Context

A user may have many envoy runs across different sessions. Listing all runs globally produces noise — runs from unrelated sessions clutter the output. But scoping visibility too tightly (e.g., to a single `sessionId`) breaks expected behavior when a session is resumed or forked, since those share history.

The question is how to scope which envoys a session can discover, without coupling envoy lifetime to session lifecycle.

## Decision

Envoy visibility is scoped to session history. When an envoy is spawned, its `runId` is recorded as a custom entry (`envoy_spawn`) in the parent session state. Session-scoped listing discovers runs by walking the session branch history and reading their state from the run store.

This is visibility only — not ownership or lifetime coupling. Ending, reloading, switching, or forking a parent session does not stop envoys. Resumed or forked sessions see envoys spawned earlier in their history because they share the same branch entries.

A global `scope: "all"` listing is also available, using the run store directory as the source of truth.

## Consequences

- Session-scoped listing shows only relevant runs by default
- Resumed and forked sessions inherit visibility naturally via shared history
- Envoy lifetime remains fully independent from session lifecycle
- The session entry is an index for discovery, not the source of truth for run state
- Session entries can outlive run data (e.g., after `remove_envoy`); discovery must handle missing runs gracefully
