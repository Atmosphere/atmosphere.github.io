---
title: "Durable Checkpoints"
description: "Persistent agent workflow state with fork/resume semantics"
---

# Durable Checkpoints

Agent workflows persist as parent-chained snapshots. Pause without holding a live thread; resume via REST, programmatic replay, or fork to explore alternative branches.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-checkpoint</artifactId>
    <version>${project.version}</version>
</dependency>
```

Maven 3.5+ no longer resolves `<version>LATEST</version>` for regular dependencies; pin an explicit version. A `<properties>` placeholder keeps cross-module upgrades to a single line.

## Quick Start

```java
CheckpointStore store = new InMemoryCheckpointStore();
store.start();

// Save a root snapshot
var root = WorkflowSnapshot.root("coord-42", myWorkflowState);
store.save(root);

// Derive a child snapshot on each workflow step
var next = root.deriveWith(updatedState);
store.save(next);

// Resume: load the latest snapshot for a coordination
var latest = store.list(CheckpointQuery.forCoordination("coord-42"))
        .stream()
        .reduce((a, b) -> b)
        .orElseThrow();

// Fork to explore an alternative branch
var branch = store.fork(latest.id(), alternativeState);
```

Application code owns the workflow state type `S` and its serialization. The in-memory store keeps state as-is; persistent stores accept a caller-supplied serializer.

## Core API

| Type | Purpose |
|------|---------|
| `CheckpointStore` | SPI: `save`, `load`, `fork`, `list`, `delete`, `deleteCoordination` |
| `WorkflowSnapshot<S>` | Immutable record of workflow state + parent link + metadata |
| `CheckpointId` | Opaque typed identifier (UUID-backed by default) |
| `CheckpointQuery` | Filter for `list()` — by coordinationId, agentName, time range, limit |
| `CheckpointEvent` | Sealed `Saved`/`Loaded`/`Forked`/`Deleted` lifecycle events |
| `CheckpointListener` | Callback for lifecycle events |
| `InMemoryCheckpointStore` | Default in-memory implementation, thread-safe, with eviction |
| `SqliteCheckpointStore` | Durable single-file SQLite store (`atmosphere-checkpoint`) — survives JVM restart |
| `PostgresCheckpointStore` | JDBC store (`atmosphere-checkpoint-postgres`); targets Postgres, works with any JSR-221 `DataSource` (operator supplies driver + pooling) |
| `Workflow<S>` / `WorkflowStep<S>` | Multi-step workflow runner over the store — see [Workflow Primitive](#workflow-primitive-durable-hibernation) |
| `DurableExecutionProvider` | ServiceLoader SPI resolving the engine behind `Workflow.run()` — in-tree step engine by default, [Temporal via `atmosphere-checkpoint-temporal`](#pluggable-durable-execution--run-the-same-workflow-on-temporal) |

## Workflow Primitive (durable hibernation)

`Workflow<S>` composes the `CheckpointStore` SPI into a multi-step workflow
runner with first-class hibernation and resume. A workflow is an ordered list
of named `WorkflowStep<S>` instances over an application-owned state `S`; each
step returns a sealed `StepOutcome` — `Advance(next)`, `Hibernate(saved)`,
`Done(final)`, or `Fail(reason)` — and a snapshot is persisted after every
completed step.

```java
var workflow = new Workflow<>(
        "doc-pipeline", "coord-123",
        List.of(
                step("ingest",  s -> StepOutcome.advance(s + ":ingested")),
                step("review",  s -> StepOutcome.hibernate(s)),    // wait for a human
                step("publish", s -> StepOutcome.done(s + ":published"))),
        store);

var result = workflow.run("doc-42");
// → WorkflowResult.Hibernated; no thread held while we wait.

// Later — same JVM or a fresh one, same store + coordinationId:
var resumed = workflow.run(null);
// → WorkflowResult.Completed; only `publish` runs.
```

Hibernation is a return-not-park primitive: no platform thread is held while
the workflow is dormant, and a later `run()` resumes at the step *after* the
last completed one — including across JVM restarts when the store is
persistent. Step names are the resume key (stable and unique), steps must be
idempotent, and each step carries its own retry budget (`maxRetries()`,
`retryDelay()`).

## Pluggable Durable Execution — run the same workflow on Temporal

Every `Workflow.run()` call resolves its execution backend through the
`DurableExecutionProvider` SPI (`ServiceLoader`): an external engine adapter
takes over when one is registered *and actually reachable*; the in-tree step
engine is the always-on fallback. The `atmosphere-checkpoint-temporal` module
ships the [Temporal](https://temporal.io) adapter — add the dependency and the
workflow above runs on a Temporal service with **no caller changes**:

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-checkpoint-temporal</artifactId>
    <version>${project.version}</version>
</dependency>
```

| Concern | Owner |
|---------|-------|
| Per-step retries (translated from `maxRetries()` / `retryDelay()`, fixed backoff) | Temporal |
| Step timeouts (start-to-close) | Temporal |
| Execution history + operational visibility (Temporal UI / CLI) | Temporal |
| Snapshot trail, hibernation, cross-restart resume (`CheckpointStore`) | Atmosphere |
| Step code + application state `S` | Your JVM |

Each step executes as a Temporal **activity in the JVM that called `run()`**,
against the live step lambdas — application state never crosses the Temporal
payload boundary, so the adapter adds **no serialization constraints on `S`**.
The adapter writes the exact snapshot trail the in-tree engine writes (same
metadata keys, same seed snapshot, same resume rule), so the two engines are
interchangeable mid-flight: hibernate on one, resume on the other.

Availability is runtime truth: the provider is selected only after a
health-checked connection succeeds; an unreachable server means the in-tree
engine runs, automatically. Configuration (system property, or the equivalent
`ATMOSPHERE_TEMPORAL_*` environment variable):

| Property | Default | Purpose |
|----------|---------|---------|
| `atmosphere.temporal.target` | `127.0.0.1:7233` | Temporal frontend host:port |
| `atmosphere.temporal.namespace` | `default` | Temporal namespace |
| `atmosphere.temporal.task-queue` | `atmosphere-workflow` | Task queue the embedded worker polls |
| `atmosphere.temporal.connect-timeout-ms` | `2000` | Connection probe timeout |
| `atmosphere.temporal.step-timeout-ms` | `3600000` | Per-step start-to-close timeout |

**Restart contract:** steps need the live session, so a run orphaned by a JVM
restart fails its next activity fast (`SessionNotFound`) instead of hanging;
the application resumes by calling `Workflow.run()` again, which picks up
after the last checkpointed step — the same restart contract as the in-tree
engine. Cross-JVM continuation of an *in-flight* run (a worker fleet picking
up mid-run) is not provided. DBOS/Restate adapters implement the same SPI.

See the [`atmosphere-checkpoint-temporal` module README](https://github.com/Atmosphere/atmosphere/blob/main/modules/checkpoint-temporal/README.md)
for the execution model and the end-to-end proof (unit tests on the Temporal
test service, plus a Playwright lane asserting the run in Temporal's own Web UI).

## CoordinationJournal Bridge

If the `atmosphere-coordinator` module is on the classpath, decorate its journal to persist a snapshot on every (or selected) coordination event:

```java
var store = new InMemoryCheckpointStore();
var journal = new CheckpointingCoordinationJournal<>(
        new InMemoryCoordinationJournal(),
        store,
        CheckpointingCoordinationJournal.onAgentBoundaries(),
        CoordinationStateExtractors.event());
journal.start();
```

Snapshots form a chain per coordination: the first snapshot is a root, each subsequent one references its predecessor. Supply a custom `CoordinationStateExtractor<S>` to capture domain state rather than the raw event.

## Listeners

```java
store.addListener(event -> {
    if (event instanceof CheckpointEvent.Saved saved) {
        metrics.counter("checkpoints.saved",
                        "coordination", saved.coordinationId()).increment();
    }
});
```

Listeners must be thread-safe. Exceptions thrown from a listener are logged and swallowed; they never abort the store operation.

## Relationship to Durable Sessions

Atmosphere has two durability primitives with distinct scopes:

| Axis | `SessionStore` | `CheckpointStore` |
|------|----------------|-------------------|
| Layer | Transport / connection | Coordinator / workflow |
| Unit persisted | `DurableSession` (rooms, broadcasters, metadata) | `WorkflowSnapshot<S>` (state, parent, agent) |
| Mutation | Overwrite-on-update | Append-only + fork |
| Triggered by | Connect/disconnect | CoordinationEvent |

They compose: carry a `CheckpointId` in `DurableSession.metadata` so a streaming client reconnecting through durable-sessions can rehydrate both its transport state and its workflow position in one flow. That is the **streaming-native resumable workflow** pattern.

See the [`atmosphere-checkpoint` module README](https://github.com/Atmosphere/atmosphere/blob/main/modules/checkpoint/README.md) for the complete design rationale and composition pattern.

## Samples

- [Spring Boot Checkpoint Agent](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-checkpoint-agent) — durable HITL workflow with `@Coordinator`, `CheckpointStore`, and REST approval

## See Also

- [Durable Sessions](durable-sessions.md)
- [AI / LLM Reference](ai.md)
- [Core Runtime](core.md)
