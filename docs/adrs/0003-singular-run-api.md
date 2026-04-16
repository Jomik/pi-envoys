# ADR 0003: Singular run API

- Status: Accepted
- Date: 2026-04-15

## Context

The core API could model envoy runs individually or use a batch-oriented abstraction that launches and manages groups of runs as a unit.

Different callers have different orchestration needs — some spawn one run, some fan out many, some chain runs sequentially.

## Decision

The core primitive models one envoy run at a time for control operations (spawn, stop, remove). Observation across multiple runs (e.g., waiting) composes from the singular primitive. Parallelism comes from spawning multiple runs, not from batching as the primary abstraction.

Embedding a specific batch or fan-out policy in the core would force callers into one orchestration model and complicate the API surface for the common single-run case. Keeping the primitive singular keeps the API simple and composes cleanly into higher-level workflow packages.

## Consequences

- Simple, predictable API
- No built-in fan-out or batch lifecycle management
- Orchestration logic lives in callers or higher-level packages
