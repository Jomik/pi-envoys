# Run model

## Run identity

Each run has:
- `runId` — canonical opaque machine identifier
- `name` — generated human-readable display name
- `status` — lifecycle state
- `startedAt` — when the run was created
- `runDir` — filesystem location for the run's persisted state

`runId` is authoritative. `name` is display-only. Control operations and storage use `runId`.

## Execution semantics

### Isolation

One envoy run maps to one `pi` subprocess. Each run executes in its own subprocess. Worktree isolation is not required.

### Context

Runs receive only the explicit launch payload: `prompt`, optional `model`, and optional `cwd`. Hidden parent session state is not inherited.

### Persistence

State is file-backed so callers can inspect runs without attaching to a live process.

`lastActivityAt` must be updated whenever the runtime observes meaningful run activity, such as subprocess start, stop handling, exit observation, or result persistence.

### Results

The core primitive does not auto-deliver results into a parent session. Callers inspect run state and outputs explicitly.

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
The subprocess has been launched and has not yet reached a terminal status.

#### `completed`
The subprocess exited successfully and the run reached its intended end state.

#### `failed`
The subprocess exited unsuccessfully or the run could not complete because of an execution error. This includes external termination (e.g., OOM kill, external `SIGKILL`).

#### `stopped`
The run was terminated by an explicit stop request.

## State transitions

Allowed transitions:

- `spawn_envoy` -> `running`
- `running` -> `completed`
- `running` -> `failed`
- `running` -> `stopped`

No transition is allowed out of a terminal status. The first observed terminal transition wins.

