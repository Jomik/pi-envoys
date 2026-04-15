# ADR 0001: Core execution model

- Status: Accepted
- Date: 2026-04-14

## Context

`pi-envoys` is intended to be a small, composable primitive for launching and managing isolated agent runs in pi.

The main design questions were:
- should runs execute in-process via an SDK or as separate subprocesses?
- should launches inherit parent context implicitly or require explicit payloads?
- should the core API be batch-oriented or centered on singular runs?
- should generated names also serve as canonical identifiers?
- should results be delivered back into the parent session automatically?

Operational behavior and file layout are defined in `docs/specs/execution.md`.

## Decision

### 1. Use subprocesses, not SDK sessions

Each envoy run will execute as a separate `pi` subprocess.

Why:
- stronger isolation
- clearer lifecycle control
- better crash containment
- lower coupling to pi SDK internals

### 2. Use explicit fresh context only

The core package will launch envoys from explicit input only.

It will not support implicit parent conversation forking or hidden context inheritance.

Why:
- makes launches easier to reason about
- reduces context leakage and bias
- keeps the primitive workflow-neutral

### 3. Center the API on singular runs

The core primitive models one envoy run at a time.

Parallelism comes from spawning multiple runs, not from making batching the primary abstraction.

Why:
- simpler API surface
- avoids embedding orchestration policy in the core package
- composes cleanly into higher-level workflow packages

### 4. Keep `runId` and `name` separate

Each envoy has:
- `runId` — canonical opaque machine identifier
- `name` — generated human-readable display name

Why:
- control and storage should not depend on display semantics
- names may change format or collide
- stable identifiers make the primitive safer to compose

### 5. Do not auto-deliver results into the parent session

Envoy runs persist state and results to disk. Callers inspect and consume them explicitly.

Why:
- keeps the package Unix-like and composable
- avoids hidden session-side effects
- leaves delivery policy to higher-level packages

Note:
- parent-session integration may still scope envoy *visibility* to the current session history
- this visibility scoping is not ownership or lifetime coupling
- envoys remain detached subprocesses whose lifetime is independent from parent session lifecycle

## Consequences

### Positive

- simple primitive
- strong isolation boundary
- file-backed inspectability
- low conceptual surface area
- clean composition into higher-level packages
- session-scoped discovery can reduce unrelated cross-session clutter without changing run lifetime semantics

### Negative

- slower startup than in-process sessions
- callers must poll or inspect state explicitly
- richer features such as steering or attach/detach are deferred

## Non-goals

This ADR does not define:
- detailed tool schemas
- exact on-disk file formats
- workflow-level orchestration

Those belong in the execution spec or future package-specific docs.
