# ADR 0004: Separate runId and name

- Status: Accepted
- Date: 2026-04-15

## Context

Each envoy needs an identifier. A generated human-readable name could double as the canonical ID, or the two concerns could be kept separate.

## Decision

Each envoy has two distinct identifiers:
- `runId` — canonical opaque machine identifier
- `name` — generated human-readable display name

Control and storage depend on `runId`, not on display semantics. Names may change format or collide; stable identifiers make the primitive safer to compose.

## Consequences

- Callers use `runId` for all programmatic operations
- Display names can evolve without breaking storage or references
- Slightly more to track per run
