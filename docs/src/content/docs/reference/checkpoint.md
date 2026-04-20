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
