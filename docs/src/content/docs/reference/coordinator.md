---
title: Coordinator
description: Multi-agent orchestration with event-sourced coordination journal, projection, persistence, and what-if forking.
---

The Atmosphere coordinator (`modules/coordinator`) provides multi-agent
orchestration: `@Coordinator`, `@Fleet`, `@AgentRef`, and an `AgentFleet`
injected into `@Prompt` methods for parallel fan-out, sequential pipelines,
conditional routing, handoffs, and quality evaluation — all auto-wired with
no boilerplate.

## Maven coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-coordinator</artifactId>
    <version>${atmosphere.version}</version>
</dependency>
```

## Minimal example

```java
@Coordinator(name = "ceo", skillFile = "prompts/ceo-skill.md",
             description = "Executive coordinator", version = "1.0.0")
@Fleet({
    @AgentRef(type = ResearchAgent.class),
    @AgentRef(value = "finance", version = "2.0.0")
})
public class CeoCoordinator {

    @Prompt
    public void onPrompt(String message, AgentFleet fleet, StreamingSession session) {
        var research = fleet.agent("research").call("web_search", Map.of("query", message));
        session.stream("Synthesis: " + research.textOr("(no result)"));
    }
}
```

## Event-sourced coordination journal

Every `AgentFleet` operation emits structured events to a pluggable
`CoordinationJournal`. The journal is the source of truth for what an
agent system did: each event is wrapped in an `EventEnvelope` carrying
its own `eventId` plus the `parentEventId` of the event that caused it,
so consumers can reconstruct the full causal DAG of any coordination.

### `EventEnvelope` — causal lineage

```java
journal.recordEnveloped(EventEnvelope.childOf(parentEventId, event));
List<EventEnvelope> envelopes = journal.retrieveEnveloped("ceo");
```

`JournalingAgentFleet` threads parent IDs through every dispatch path:

- `CoordinationStarted` → root (no parent)
- `AgentDispatched` → child of `CoordinationStarted`
- `AgentCompleted` / `AgentFailed` → child of matching `AgentDispatched`
- `AgentEvaluated` → child of the corresponding `AgentCompleted`
- `RouteEvaluated` / `proxy.call()` dispatches → roots (no surrounding `Started`)
- `CommitmentRecorded` → child of the dispatch it accompanies
- `CoordinationCompleted` → child of `CoordinationStarted`

Legacy `record(event)` callers continue to work unchanged — events get
wrapped as root envelopes with no parent.

### Event variants

| Event | Fields |
|-------|--------|
| `CoordinationStarted` | coordinationId, coordinatorName, timestamp |
| `AgentDispatched` | coordinationId, agentName, skill, args, timestamp |
| `AgentCompleted` | coordinationId, agentName, skill, resultText, duration, timestamp |
| `AgentFailed` | coordinationId, agentName, skill, error, duration, timestamp |
| `AgentEvaluated` | coordinationId, agentName, evaluatorName, score, passed, timestamp |
| `AgentHandoff` | coordinationId, fromAgent, toAgent, reason, timestamp |
| `RouteEvaluated` | coordinationId, inputAgent, matchedRouteIndex, selectedAgent, matched, timestamp |
| `AgentActivityChanged` | coordinationId, agentName, activityType, detail, timestamp |
| `CircuitStateChanged` | coordinationId, agentName, fromState, toState, timestamp |
| `CommitmentRecorded` | coordinationId, signed `CommitmentRecord`, timestamp |
| `CoordinationCompleted` | coordinationId, totalDuration, agentCallCount, timestamp |
| `ForkCreated` | coordinationId (new), parentCoordinationId, parentEventId, reason, timestamp |

### `CoordinationProjection` — DAG from log

Pure read-only projection that builds the causal DAG from the stored
envelopes. No execution, no LLM, no side effects:

```java
var projection = CoordinationProjection.from(journal, "ceo");

projection.walk((env, depth) -> {
    var pad = " ".repeat(depth * 2);
    System.out.println(pad + env.event().toLogLine());
});

// Aggregates
projection.agents();           // distinct agents that participated
projection.failedDispatches(); // every AgentFailed envelope
projection.evaluations();      // every AgentEvaluated envelope
projection.roots();            // entry points of the DAG
projection.children(eventId);  // direct children
projection.event(eventId);     // Optional<EventEnvelope> lookup
```

### `FileCoordinationJournal` — append-only NDJSON

Persistent backend that survives JVM restart. One JSON object per line;
replays on `start()` into an in-memory index for queries; tolerates a
truncated final line from a JVM kill mid-append (logs and skips); single-writer
locked appends.

```java
var journal = new FileCoordinationJournal(Path.of("coord.ndjson"));
journal.start();
// ... record events ...
journal.stop();

// Process restart later — replay survives:
var sameJournal = new FileCoordinationJournal(Path.of("coord.ndjson"));
sameJournal.start();
var envelopes = sameJournal.retrieveEnveloped("ceo");  // full lineage restored
```

Polymorphic ser/deser of the sealed `CoordinationEvent` hierarchy is
configured via a Jackson 3 mix-in inside `FileCoordinationJournal` so
the event records themselves stay annotation-free for non-persistence
consumers.

### `CoordinationFork` — what-if branching

Branches a new coordination off any event in an existing one. The parent
coordination is immutable; the fork is a peer with its own id and its
own future. Cross-coord traversal goes through the
`parentCoordinationId` / `parentEventId` fields on the `ForkCreated` record.

```java
var fork = new CoordinationFork(journal);
var result = fork
    .from("ceo", parentEventId)
    .reason("try beta instead of alpha")
    .with(new AgentCall("beta", "answer", Map.of("q", "...")))
    .execute(fleet);

// result.newCoordinationId() identifies the forked branch
// CoordinationProjection.from(journal, result.newCoordinationId())
//   shows the alternate's events
```

`JournalingAgentFleet.withCoordinationId(String)` returns a fleet
decorator that records under an explicit coordination id rather than
the coordinator-name-derived default — used internally by
`CoordinationFork` and available to any caller that needs to pin
journal output to a known coordination id.

Typical use cases:

- **Evaluation tooling** — compare agent A vs B on the same logged prompt
- **Debugging** — rewind to a decision point and rerun with different args
- **Regression isolation** — replay a flaky coordination with deterministic inputs

### Pluggable backends

- `InMemoryCoordinationJournal` (default, bounded eviction)
- `FileCoordinationJournal` (append-only NDJSON, JVM-restart safe)
- `CheckpointingCoordinationJournal` in `atmosphere-checkpoint` (decorator
  that also persists a `WorkflowSnapshot` to a `CheckpointStore` on every
  matching event for workflow resume)
- Custom backends via the `CoordinationJournal` SPI — `ServiceLoader`
  discovers any `META-INF/services/org.atmosphere.coordinator.journal.CoordinationJournal`
  on the classpath

### Inspectors

Suppress events before storage:

```java
journal.inspector(event ->
    !(event instanceof CoordinationEvent.AgentDispatched)); // skip dispatch noise
```

### Query API

```java
CoordinationQuery.all();
CoordinationQuery.forCoordination("ceo");
CoordinationQuery.forAgent("research");
```

## See also

- [Admin Control Plane](/docs/reference/admin/) — journal flow viewer
- [Durable Checkpoints](/docs/reference/checkpoint/) — workflow resume
  via `CheckpointingCoordinationJournal`
- The full [`modules/coordinator/README.md`](https://github.com/Atmosphere/atmosphere/blob/main/modules/coordinator/README.md)
  in the main repo
