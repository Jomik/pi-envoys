# ADR 0005: No auto-delivery of results

- Status: Accepted
- Date: 2026-04-15

## Context

When an envoy completes, its results could be automatically injected into the parent session or left on disk for explicit inspection. Different callers want different delivery semantics — some summarize, some extract structured data, some discard.

## Decision

Envoy runs persist state and results to disk. Callers inspect and consume them explicitly. No automatic delivery into the parent session.

Auto-injection is unpredictable when multiple envoys complete concurrently, can surprise the parent agent with unexpected content, and bakes in a single delivery policy. Leaving results on disk keeps the package composable and lets callers choose how and when to consume.

## Consequences

- Callers must poll or inspect state explicitly
- No surprise injections into conversation flow
- Higher-level packages can implement whatever delivery policy fits their use case
