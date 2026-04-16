# ADR 0001: Use subprocesses for envoy runs

- Status: Accepted
- Date: 2026-04-15

## Context

Envoy runs need an execution model. The two main options are launching a separate `pi` subprocess per run or hosting runs in-process via an SDK session.

## Decision

Each envoy run executes as a separate `pi` subprocess.

A crashed or hung run must not take down the caller or other runs. Subprocesses provide that isolation. They also give the caller clean lifecycle control — start, poll, stop, remove — without managing internal SDK session state, and avoid coupling to pi SDK internals that could break across releases.

## Consequences

- Clean process-level isolation between runs
- Slower startup than in-process sessions
- Callers cannot interact with runs via in-process APIs; must use file-backed state
