# API spec

## Goal

Provide a minimal Unix-style primitive for launching and managing isolated envoy runs.

## Invariants

- launches use explicit payloads only
- no implicit parent conversation or hidden context inheritance
- the package is workflow-neutral

## Status accuracy

All operations that return run status must reflect actual process state. If a subprocess has exited, the returned status must be terminal — even if the subprocess did not shut down cleanly. Implementations must not return `running` for a dead process.

## Public API

### `spawn_envoy`

Starts one fresh isolated envoy run.

Input:
- `prompt` — exact task payload for the run
- optional `agent` — name of an agent definition to configure the child subprocess (see [agent definitions](agent-definitions.md))

Behavior:
1. allocate a new `runId`
2. create the run directory
3. persist launch inputs
4. start a new `pi` subprocess for the run
5. initialize run state as `running`
6. record the spawned `runId` in the parent session state so later session-scoped listing can discover it across reload, resume, and fork (see [session-scoping](session-scoping.md))

Output:
- `runId`
- `name`
- `status`
- `runDir`

Postconditions:
- `status` is `running` on success
- `runDir` exists and is writable

### `list_envoys`

Lists known envoy runs.

Input:
- optional `scope` — `"session"` or `"all"` (default: `"session"`)
  - `session`: list runs known to the current session history (see [session-scoping](session-scoping.md))
  - `all`: list all runs from the local run store

Source of truth:
- for `scope: "session"`, the current session history identifies known `runId`s; run state is then read from the local run store
- for `scope: "all"`, the local run store is the source of truth

Returns per run:
- `runId`
- `name`
- `status`
- `startedAt`
- `lastActivityAt`
- `runDir`

`lastActivityAt` is the most recent time the runtime observed meaningful run activity.

Ordering is implementation-defined.

### `get_envoy`

Returns the full state of a single envoy identified by `runId`.

Input:
- `runId`

Behavior:
- read and return the run's current state

Returns:
- `runId`
- `name`
- `status`
- `startedAt`
- `lastActivityAt`
- `runDir`
- optional `result` — present for terminal runs, containing:
  - `finalText` — the envoy's final response
  - `errorMessage` — present when the run failed
  - `exitCode`
  - `signal` — the signal that terminated the process, if any
  - `usage`

### `wait_envoys`

Blocks until one or all specified envoys reach a terminal status.

Input:
- `runIds` — array of run IDs to wait on
- `mode` — `"all"` or `"any"`
  - `all`: wait until every specified run is terminal
  - `any`: wait until at least one specified run is terminal
- optional `timeout` — maximum seconds to wait (default: 600)

Behavior:
- poll the specified runs internally until the mode condition is met or the timeout expires
- stream progress updates to the UI via the tool update callback; these updates are visible to the user but do not enter the LLM context
- on completion or timeout, return the current state of all specified runs
- must respect the abort signal; if aborted, return whatever state is available

Returns:
- `timedOut` — whether the wait ended due to timeout
- `results` — array of per-run entries, each containing the same fields as `get_envoy` output

Postconditions:
- no runs are stopped or modified by the wait itself
- runs that were already terminal before the call are included immediately

`wait_envoys` does not stop or clean up runs. It is a read-only blocking poll.

### `stop_envoy`

Stops a running envoy identified by `runId`.

Behavior:
1. request graceful stop
2. wait for a grace period
3. force kill if still running
4. persist terminal status

Postconditions:
- final status is `stopped` if the run did not already reach another terminal status (see [status model](run-model.md#status-model))
- run metadata remains present in the local run store

### `remove_envoy`

Removes a terminal envoy from the local run store.

Preconditions:
- the run must be in a terminal status (see [terminal statuses](run-model.md#terminal-statuses))

Behavior:
- if the run is not in a terminal status, reject the request
- otherwise delete the run's persisted state for the specified `runId`

`remove_envoy` must not stop running work implicitly.

## Non-goals

- in-process SDK backend
- implicit parent-context forking
- chain mode
- built-in workflow packages
- background auto-delivery into the parent session
- interactive steering
- worktree isolation
