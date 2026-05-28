---
title: "Durable HITL Workflows"
description: "Pause an agent flow at an approval checkpoint, persist the workflow snapshot, and resume hours or days later — using @Coordinator, CheckpointStore, and an app-level approve endpoint."
---

# Durable HITL Workflows

Atmosphere ships two distinct human-in-the-loop primitives. They solve
different problems and the gap between them is a frequent source of
confusion, so this chapter draws the line explicitly:

| Pattern | Where it lives | Persistence | When the parked agent thread exists |
|---|---|---|---|
| **In-session approval** | `@RequiresApproval` on a tool + `VirtualThreadApprovalStrategy` | In-memory (`ConcurrentHashMap` in `ApprovalRegistry`) | One agent VT stays parked on `CompletableFuture.get(timeout)` for the lifetime of the approval |
| **Durable HITL** | `@Coordinator` + `CheckpointingCoordinationJournal` + app-level approve endpoint | `CheckpointStore` SPI (`SqliteCheckpointStore` ships in-tree) | None — the analyzer agent finishes, the snapshot is persisted, and *no thread is kept alive* during the pause |

This chapter covers the second pattern, which survives JVM restarts. The
first pattern is the right choice when you need a fast confirmation
on a synchronous tool call and the user is going to answer in seconds;
it is documented in the [Tool Approval Policy reference](../../reference/tool-approval-policy/).
For long-pause workflows — refunds requiring overnight legal review,
compliance sign-offs across a deploy window, content moderation queues —
you want durable HITL.

## The pattern

1. A `@Coordinator` accepts a request over WebSocket/SSE and dispatches
   to an **analyzer** agent that produces a recommendation.
2. The framework's coordination journal, wrapped in
   `CheckpointingCoordinationJournal`, captures the analyzer's
   `AgentCompleted` event as a `WorkflowSnapshot` in the configured
   `CheckpointStore`. The stream returns to the client with a pointer
   to the checkpoint id.
3. Time passes. The original WebSocket can close, the JVM can restart,
   the reviewer can go home for the night. The snapshot persists.
4. A reviewer (human, automated gate, or the `atmosphere checkpoint`
   CLI) lists pending snapshots over HTTP, inspects them, and calls
   `POST /api/checkpoints/{id}/approve`.
5. That endpoint — an **app-level controller** that the sample provides,
   not a framework-shipped controller — recovers the original request
   from the persisted snapshot state, invokes an **approver** agent,
   and chains the approver's completion as a child snapshot via
   `store.fork(...)`. The child IS the workflow continuation.

The chain `analyzer → approver` now spans whatever gap separated the
two HTTP calls, with the parent/child snapshot link providing the
causal audit trail.

## What does *not* ship out of the box

Two things people reasonably expect that the framework does **not**
provide automatically — see them clearly before you start, because
the sample has to wire them and so will yours:

- **No durable `ApprovalStrategy`.** Only `VirtualThreadApprovalStrategy`
  ships, and it is in-memory. The strategy's `awaitApproval` parks a
  virtual thread on a `CompletableFuture<Boolean>` keyed by approval
  id in `ApprovalRegistry`'s `ConcurrentHashMap`. A JVM restart loses
  every parked approval; a client disconnect triggers
  `ApprovalRegistry.cancelAllPending()` which force-denies every
  outstanding approval on that session. This is correct behaviour for
  the in-session pattern (you don't want approvals to silently survive
  a disconnect) — it just means the in-session strategy is not the
  durable building block.
- **No `/__approval/<id>/approve` REST controller.** The
  `/__approval/<id>/approve` and `/__approval/<id>/deny` strings ARE
  real — but they are **Atmosphere message protocol** payloads carried
  over the same WebSocket/SSE channel as the agent stream, not HTTP
  endpoints. `ApprovalRegistry.resolve(String)` parses them out of the
  inbound message flow inside `AgentProcessor`, `CoordinatorProcessor`,
  and `AgUiHandler`. They cannot reach a JVM that does not have the
  pending approval id in its in-process map, so they are scoped to one
  live session.

Durable HITL bypasses both of those constraints by capturing the
analyzer's completion **as a checkpoint**, not as a parked approval,
and exposing the checkpoint store over an app-level REST API the
reviewer can call from anywhere.

## Wiring the `CheckpointStore`

Atmosphere ships two `CheckpointStore` implementations:

- **`InMemoryCheckpointStore`** — default when no other store is wired;
  non-durable. Use in tests and single-process dev environments.
- **`SqliteCheckpointStore`** — file-backed; survives JVM restarts on
  the same host. Single-node durability.

The `CheckpointStore` interface is an SPI: adapters for Redis,
Postgres, DynamoDB, S3, etc. plug in by implementing `save`, `load`,
`list`, `fork`, and `delete`. `SqliteCheckpointStore` is the reference
implementation and the file to copy.

### Spring Boot wiring

```java
@Configuration
public class CheckpointConfig {

    @Bean
    public CheckpointStore checkpointStore(
            @Value("${atmosphere.checkpoint.store:sqlite}") String backend,
            @Value("${atmosphere.checkpoint.sqlite.path:target/checkpoint.db}") String path) {
        return switch (backend) {
            case "in-memory" -> new InMemoryCheckpointStore();
            case "sqlite"    -> new SqliteCheckpointStore(Path.of(path));
            default          -> throw new IllegalArgumentException(
                    "Unknown checkpoint store: " + backend);
        };
    }

    /**
     * Wrap the coordination journal so AgentCompleted events become
     * WorkflowSnapshot writes in the checkpoint store.
     */
    @Bean
    @Primary
    public CoordinationJournal coordinationJournal(CheckpointStore store) {
        var underlying = new InMemoryCoordinationJournal();
        return new CheckpointingCoordinationJournal<>(
                underlying,
                store,
                CheckpointingCoordinationJournal.onAgentBoundaries(),
                CoordinationStateExtractors.event());
    }
}
```

The 4-arg constructor is the real one: `delegate` journal, `store`,
a `Predicate<CoordinationEvent>` deciding which events become snapshots
(`onAgentBoundaries()` captures `AgentCompleted` + `AgentFailed`), and
a `CoordinationStateExtractor<S>` mapping the event to the snapshot
state payload (`CoordinationStateExtractors.event()` stores the event
itself as the state).

`CheckpointingCoordinationJournal` is the bridge that turns "every
`AgentCompleted` event the coordination emits" into "a snapshot in the
checkpoint store keyed by coordination id." Without this wrapper, the
journal stays in-memory and your durable HITL flow has no durability —
the journal default is `NOOP` (see the
[Coordinator reference](../../reference/coordinator/) for the
journaling-is-opt-in contract).

## The two agents

```java
@Agent(name = "analyzer",
        description = "Analyzes a request and produces a structured recommendation")
@Component
public class AnalyzerAgent {

    @AiTool(name = "analyze",
            description = "Analyze the request and produce a recommendation with risk level")
    public String analyze(@Param("request") String request) {
        // In production: call a real LLM via @Prompt + AgentRuntime.
        // The sample returns deterministic JSON so it runs without an API key.
        return /* ... */;
    }
}

@Agent(name = "approver",
        description = "Resumes a previously analyzed request after human approval")
@Component
public class ApproverAgent {

    public ApprovalDecision execute(String originalRequest, String approver) {
        // Re-runs the side-effect now that approval has been granted.
        return /* ... */;
    }
}
```

`AnalyzerAgent` is a normal `@Agent` whose `AgentCompleted` event the
journal will capture as a snapshot.

`ApproverAgent` exposes a plain method (no `@Prompt`, no
`@RequiresApproval`) — it is invoked **directly** by the approve
endpoint on the HTTP thread, not over the agent stream. This is the
key shape change vs the in-session pattern: the resumption point is an
HTTP call that walks the persisted state, not a parked VT waking up.

## The coordinator

```java
@Coordinator(name = "dispatch",
        description = "Analyzer/approver dispatch with checkpointed HITL pauses")
@Fleet({
        @AgentRef(type = AnalyzerAgent.class),
        @AgentRef(type = ApproverAgent.class)
})
@Component
public class DispatchCoordinator {

    @Prompt
    public void onPrompt(String message, AgentFleet fleet, StreamingSession session) {
        // Step 1 — analyze. CheckpointingCoordinationJournal persists an
        // AgentCompleted snapshot automatically after this call.
        var analysis = fleet.agent("analyzer").call("analyze",
                Map.of("request", message));
        if (!analysis.success()) {
            session.stream("Analyzer failed: " + analysis.text());
            return;
        }

        // Step 2 — surface the checkpoint pointer so the human reviewer
        // can find the snapshot via the REST API.
        session.stream("Analysis complete.\n\n"
                + "Result: " + analysis.text() + "\n\n"
                + "Checkpointed. Review via GET /api/checkpoints?coordination=dispatch, "
                + "then POST /api/checkpoints/{id}/approve to resume.");
    }
}
```

The coordinator's `@Prompt` finishes at step 2 — no thread is parked,
the WebSocket can close, the JVM can restart. The next chapter of the
workflow runs only when a reviewer hits the approve endpoint.

## The approve endpoint (app-level REST)

```java
@RestController
@RequestMapping("/api/checkpoints")
public class CheckpointController {

    private final CheckpointStore store;
    private final ApproverAgent approverAgent;

    public CheckpointController(CheckpointStore store, ApproverAgent approverAgent) {
        this.store = store;
        this.approverAgent = approverAgent;
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(required = false) String coordination,
            @RequestParam(defaultValue = "100") int limit) {
        var query = CheckpointQuery.builder()
                .coordinationId(coordination)
                .limit(limit)
                .build();
        return store.list(query).stream().map(this::toJson).toList();
    }

    @PostMapping("/{id}/approve")
    public ResponseEntity<Map<String, Object>> approve(
            @PathVariable String id,
            @RequestParam(defaultValue = "operator") String by,
            @RequestParam(required = false) String request) {
        var parent = store.load(CheckpointId.of(id)).orElse(null);
        if (parent == null) {
            return ResponseEntity.notFound().build();
        }
        var originalRequest = (request != null)
                ? request
                : extractRequestFromParentState(parent);

        // Invoke approver — runs on the HTTP thread, returns inline.
        var decision = approverAgent.execute(originalRequest, by);

        // Fork the parent snapshot so the approver's completion is a
        // child of the analyzer's snapshot — that link IS the durable
        // workflow's audit trail.
        var child = store.fork(CheckpointId.of(id),
                "Executed '" + originalRequest + "' approved by " + by);
        return ResponseEntity.ok(toJson(child));
    }
}
```

`CheckpointController` is **app-level code** that the
`spring-boot-checkpoint-agent` sample ships. The framework provides
the `CheckpointStore` SPI and the `CheckpointingCoordinationJournal`
bridge; the REST surface (and the choice of when to invoke the
approver) is yours.

This is the deliberate split: the framework persists snapshots; the
application decides what an "approval" means, who can issue one, and
what runs when one arrives.

## The full flow

```
T+0s     Client opens WebSocket to /atmosphere/agent/dispatch
T+0.1s   DispatchCoordinator.onPrompt invokes the analyzer
T+0.5s   AnalyzerAgent returns, fleet emits AgentCompleted
T+0.5s   CheckpointingCoordinationJournal writes a WorkflowSnapshot
         to SqliteCheckpointStore (parent id captured)
T+0.6s   Coordinator streams "Analysis complete. Review at ..." and exits
T+0.6s   WebSocket closes — no thread is kept alive

           ... minutes / hours / days / one JVM restart ...

T+8h     Reviewer hits GET /api/checkpoints?coordination=dispatch
T+8h+1m  Reviewer hits POST /api/checkpoints/<parentId>/approve?by=alice
T+8h+1m  CheckpointController.approve loads the parent snapshot, recovers
         the original request, invokes ApproverAgent.execute, and forks
         a child snapshot recording the approver's completion
T+8h+1m  HTTP response carries the child snapshot id back to the reviewer
```

The session that started the work and the session that finished it can
be on different JVMs running on different hosts. The only state that
crosses the gap is the snapshot in the `CheckpointStore`.

## Parent-chained snapshots

Every snapshot records a `parentCheckpointId`. The analyzer's snapshot
has no parent (it is a root); the approver's snapshot points at the
analyzer's. Multi-step HITL flows extend the chain:

```
snapshot-1: analyzer recommendation              ← root
    ↓ parentCheckpointId = snapshot-1
snapshot-2: approver decision (HITL pause #1)
    ↓ parentCheckpointId = snapshot-2
snapshot-3: payer approval (HITL pause #2)
```

The chain is the audit trail. `store.fork(...)` is what writes it; the
sample's commitment-record wiring adds an Ed25519 signature to each
snapshot so the chain is cryptographically verifiable. See
`CommitmentConfig.java` in the sample for the signer setup.

## In-session approval (for completeness)

When the user is going to answer in seconds and a restart-safe pause
is overkill, the in-session pattern is the right choice. Annotate the
tool with `@RequiresApproval`, install
`ApprovalStrategy.virtualThread(registry)` on the agent execution
context, and the framework will:

1. Park the agent's virtual thread on a `CompletableFuture<Boolean>`
   keyed by an approval id in the in-memory `ApprovalRegistry`.
2. Emit `AiEvent.ApprovalRequired` to the streaming session.
3. Wait for the client to send `/__approval/<id>/approve` or
   `/__approval/<id>/deny` over the same Atmosphere channel as the
   agent stream — this is a message protocol, not an HTTP endpoint.
4. Unpark the VT when the message lands, or force-deny on disconnect
   via `ApprovalRegistry.cancelAllPending()`, or time out per
   `@RequiresApproval(timeoutSeconds = ...)`.

The full reference for that path is on the
[Tool Approval Policy](../../reference/tool-approval-policy/) page.
Mixing it with the durable pattern is supported but uncommon: most
applications pick one shape per workflow.

## Cooperating with `ExecutionHandle.cancel()`

A caller holding an `ExecutionHandle` can cancel an in-flight
coordinator dispatch. The cancel unwinds the coordinator's VT, the
analyzer call (if still running) gets a `CancellationException` via
the runtime's cancel primitive, and no snapshot is written if the
analyzer never reached `AgentCompleted`. Snapshots already on disk
are untouched — they remain available to the approve endpoint
indefinitely; deletion is explicit (`DELETE /api/checkpoints/{id}`).

## Running the sample

```bash
./mvnw spring-boot:run -pl samples/spring-boot-checkpoint-agent
```

1. Open a WebSocket: `wscat -c ws://localhost:8095/atmosphere/agent/dispatch`
2. Send a request: `please refund order 1234`
3. Read the response — it includes a checkpoint id
4. List snapshots: `curl http://localhost:8095/api/checkpoints?coordination=dispatch`
5. **Restart the JVM** (`Ctrl-C`, then `./mvnw spring-boot:run ...` again)
6. Approve: `curl -X POST 'http://localhost:8095/api/checkpoints/<id>/approve?by=alice'`
7. Watch the approver run on the fresh JVM and the response carry the
   child snapshot id back

The SQLite database lives at `target/checkpoint.db` by default. Override
with `--atmosphere.checkpoint.sqlite.path=/path/to/durable.db` for a
location outside the Maven `target/` directory if you want state to
survive `mvn clean`.

## When to use durable HITL

Pick this pattern when:

- Compliance workflows (SOX, HIPAA, SOC 2) require human sign-off and
  the reviewer is not the same session
- Financial flows where a manager approves overnight
- Content moderation queues where review happens hours later
- Infrastructure changes that must clear a deploy window
- Any flow where the reviewer might be a CLI or automated gate, not a
  browser

Prefer the in-session pattern when:

- The user is going to answer in seconds and is staring at the chat
- The agent flow is fully synchronous within one request
- A disconnect should cancel the approval, not preserve it

## See also

- [Tool Approval Policy](../../reference/tool-approval-policy/) — `@RequiresApproval` + `ApprovalStrategy` reference
- [Coordinator](../../reference/coordinator/) — `@Coordinator` + `@Fleet` + journaling contract
- [Durable Checkpoints](../../reference/checkpoint/) — `CheckpointStore` SPI
- [ExecutionHandle](../../reference/execution-handle/) — cancellation across the coordinator
- [`spring-boot-checkpoint-agent` sample](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-checkpoint-agent) — full runnable code
