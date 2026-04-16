# Session scoping

## Overview

Envoy visibility is scoped to session history by default. This reduces noise from unrelated sessions without coupling envoy lifetime to session lifecycle.

## Discovery mechanism

When an envoy is spawned, its `runId` is recorded as a custom entry (`envoy_spawn`) in the parent session state. Session-scoped listing discovers runs by walking the session branch history and collecting `runId`s from these entries. Run state is then read from the run store.

The session entry is an index for discovery, not the source of truth for run state.

Session scoping gates discovery via `list_envoys`. It does not apply to direct `runId` operations.

Discovered `runId`s whose run data no longer exists in the run store are silently skipped.

## Scope modes

- `"session"` (default): list runs whose `runId`s appear in the current session history
- `"all"`: list all runs from the run store, ignoring session history

## Visibility vs lifetime

Session scoping affects visibility only. It does not affect envoy lifetime or imply exclusive ownership.

Ending, reloading, switching, or forking a parent session must not implicitly stop envoys.

## Resume and fork behavior

Session-scoped visibility is based on session history, not strict current `sessionId`. Resumed or forked conversations can still see envoys spawned earlier in that history because they share the same branch entries.
