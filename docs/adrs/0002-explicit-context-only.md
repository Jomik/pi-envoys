# ADR 0002: Explicit context only

- Status: Accepted
- Date: 2026-04-15

## Context

When launching an envoy, the caller could either pass an explicit prompt or implicitly fork/inherit context from the parent session.

## Decision

Envoys launch from explicit input only. No implicit parent conversation forking or hidden context inheritance.

This makes launches easier to reason about, reduces context leakage and bias, and keeps the primitive workflow-neutral.

## Consequences

- Callers must provide all necessary context in the prompt
- No risk of accidental context bleeding between sessions
- Higher-level packages can layer context-forwarding on top if needed
