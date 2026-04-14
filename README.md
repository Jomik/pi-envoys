# @jomik/pi-envoys

Small primitive for launching and managing isolated envoy runs in pi.

## Scope

`pi-envoys` does one thing:
- launch and manage isolated envoy runs

It does not own higher-level workflow semantics such as:
- research/spec/plan phases
- chain orchestration
- review policy
- result synthesis

## Status

Scaffold only. No implementation yet.

## API surface

- `spawn_envoy` — start one fresh isolated envoy run
- `list_envoys` — list known runs from the local run store
- `stop_envoy` — stop a running envoy
- `remove_envoy` — remove a terminal envoy from the local run store

## Core concepts

- each envoy is a separate subprocess
- launches use explicit input only; no implicit parent context inheritance
- run state is file-backed
- `runId` is the canonical machine identifier
- `name` is generated for display only

## Docs

- execution spec: `docs/specs/execution.md`
- design rationale: `docs/adrs/0001-core-execution-model.md`
