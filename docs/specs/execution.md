# Execution spec

## Goal

Provide a minimal Unix-style primitive for launching and managing isolated envoy runs.

## Invariants

- one envoy run maps to one `pi` subprocess
- launches use explicit payloads only
- no implicit parent conversation or hidden context inheritance
- run state is persisted on disk
- `runId` is authoritative; `name` is display-only
- the package is workflow-neutral

## Run model

Each run has:
- `runId` — canonical opaque machine identifier
- `name` — generated human-readable display name
- `status` — lifecycle state
- `runDir` — filesystem location for the run's persisted state

`runId` and `name` must remain separate. Control operations and storage use `runId`.

## Public API

### `spawn_envoy`

Starts one fresh isolated envoy run.

Input:
- `prompt` — exact task payload for the run
- optional `model` — model selector for the subprocess
- optional `cwd`

Behavior:
1. allocate a new `runId`
2. create the run directory
3. persist launch inputs
4. start a new `pi` subprocess for the run
5. initialize run state as `running`

Output:
- `runId`
- `name`
- `status`
- `runDir`

Postconditions:
- `status` is `running` on success
- `runDir` exists and is writable

### `list_envoys`

Lists known envoy runs from the local run store.

Source of truth:
- the directory tree under the run store root
- no separate database is required

Returns per run:
- `runId`
- `name`
- `status`
- `startedAt`
- `lastActivityAt`
- `runDir`
- optional `model`

`lastActivityAt` is the most recent time the runtime observed meaningful run activity.

Ordering is implementation-defined.

### `get_envoy`

Returns the full state of a single envoy identified by `runId`.

Input:
- `runId`

Behavior:
- reconcile the run's on-disk state with process liveness
- read and return the run's current state

Returns:
- `runId`
- `name`
- `status`
- `startedAt`
- `lastActivityAt`
- `runDir`
- optional `model`
- optional `prompt` — the original launch prompt
- optional `result` — present for terminal runs, containing:
  - `finalText` — the envoy's final response
  - `errorMessage` — present when the run failed
  - `exitCode`
  - `usage`

`get_envoy` must reconcile the run before returning.

### `wait_envoys`

Blocks until one or all specified envoys reach a terminal state.

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
4. persist terminal state

Postconditions:
- final status is `stopped` if the run did not already reach another terminal state
- run metadata remains present in the local run store

### `remove_envoy`

Removes a terminal envoy from the local run store.

Preconditions:
- the run must be in a terminal state

`remove_envoy` must reconcile the run before checking the precondition. A subprocess may have exited without the on-disk status reflecting that. Without reconciliation, crashed or completed runs whose `status.json` still reads `running` would be incorrectly rejected.

Behavior:
- reconcile the run's on-disk state with process liveness
- if the run is still non-terminal after reconciliation, reject the request
- otherwise delete the run record and run directory for the specified `runId`

`remove_envoy` must not stop running work implicitly.

## Status model

Statuses:
- `running`
- `completed`
- `failed`
- `stopped`

### Terminal statuses

Terminal:
- `completed`
- `failed`
- `stopped`

Non-terminal:
- `running`

### Status meaning

#### `running`
The subprocess has been launched and has not yet reached a terminal state.

#### `completed`
The subprocess exited successfully and the run reached its intended end state.

#### `failed`
The subprocess exited unsuccessfully or the run could not complete because of an execution error.

#### `stopped`
The run was terminated by an explicit stop request.

## State transitions

Allowed transitions:

- `spawn_envoy` -> `running`
- `running` -> `completed`
- `running` -> `failed`
- `running` -> `stopped`

No transition is allowed out of a terminal state.

## On-disk layout

Run store root:
- `${PI_CODING_AGENT_DIR}/envoys/runs/` when `PI_CODING_AGENT_DIR` is set
- otherwise `~/.pi/agent/envoys/runs/`

Layout:

```text
<run-store-root>/
  <runId>/
    request.json
    status.json
    result.json
    stderr.log
```

Per-run files:
- `request.json` — launch request metadata, including the exact prompt and any explicit launch options
- `status.json` — current status and lifecycle timestamps, including `startedAt` and `lastActivityAt`
- `result.json` — structured terminal result; present for terminal runs
- `stderr.log` — process stderr output when available

Always required:
- `request.json`
- `status.json`

Required for terminal runs:
- `result.json`

Optional:
- `stderr.log`

## Execution semantics

### Isolation

Each run executes in its own subprocess. Worktree isolation is not required.

### Context

Runs receive only the explicit launch payload: `prompt`, optional `model`, and optional `cwd`. Hidden parent session state is not inherited.

### Persistence

State is file-backed so callers can inspect runs without attaching to a live process.

`lastActivityAt` must be updated whenever the runtime observes meaningful run activity, such as subprocess start, stdout or stderr output, stop handling, exit observation, or result persistence.

### Results

The core primitive does not auto-deliver results into a parent session. Callers inspect run state and outputs explicitly.

## Reconciliation

On-disk status may become stale. A subprocess can exit (crash, signal, clean exit) while `status.json` still reads `running`. Reconciliation resolves this by comparing persisted state with process liveness.

Reconciliation is an internal mechanism, not a public API operation. It runs automatically as part of `list_envoys`, `stop_envoy`, and `remove_envoy`.

### Rules

Given a run whose `status.json` reads `running`:

1. **Process alive**: status remains `running`.
2. **Process dead, `result.json` exists**: adopt the terminal status from `result.json` into `status.json`.
3. **Process dead, no `result.json` yet**: the process may have exited before finishing file writes. Wait a bounded period for `result.json` to appear. If it appears, apply rule 2. If the wait expires, fall through to rule 4.
4. **Process dead, no terminal artifacts**:
   - if the parent previously sent a termination signal as part of `stop_envoy`, mark `stopped`.
   - otherwise mark `failed`.

A stop having been *requested* is not sufficient evidence for `stopped`. The parent must have actually sent a termination signal.

### Bounded wait

The finalization wait in rule 3 must be bounded. The implementation defines the maximum wait duration and polling interval. Unbounded or indefinite polling is not permitted.

### Consistency

Reconciliation must not transition a run that is already in a terminal state. Terminal states are final.

## Non-goals

- in-process SDK backend
- implicit parent-context forking
- chain mode
- built-in workflow packages
- background auto-delivery into the parent session
- interactive steering
- worktree isolation
