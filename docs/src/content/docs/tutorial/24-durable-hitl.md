---
title: "Durable HITL Workflows"
description: "Build a @RequiresApproval workflow that survives a process restart — CheckpointStore + ApprovalStrategy + REST approve round-trip"
---

# Durable HITL Workflows

In a standard HITL (Human-in-the-Loop) flow, an `@AiTool` marked
`@RequiresApproval` parks a virtual thread on the session-scoped
`ApprovalStrategy` until the user sends an approve or deny message. If the
JVM restarts while the thread is parked, the approval is lost and the
workflow cannot resume.

**Durable HITL** combines `@RequiresApproval` with the `CheckpointStore` SPI
so an approval pending at 4:59pm survives a redeploy and resumes when a
user returns the next morning. This chapter walks through the full pattern.

## The problem

```java
@Agent
public class RefundAgent {

    @AiTool(description = "Issue a refund to a customer account")
    @RequiresApproval(message = "Confirm the refund amount and destination account.")
    public RefundResult issueRefund(String customerId, BigDecimal amount) {
        return paymentProvider.refund(customerId, amount);
    }
}
```

A customer-service agent kicks off a $500 refund at 4:59pm. The virtual
thread parks on the approval gate. At 5:00pm the CI pipeline pushes a new
build and every JVM on the fleet restarts. The parked thread dies, the
approval is orphaned, the manager's 6pm approval email never reaches a
listener.

## The solution

Three pieces cooperate:

1. **`@RequiresApproval`** — annotation on the `@AiTool` method that forces
   the invocation through the `ApprovalStrategy`. You already know this.
2. **`CheckpointStore`** — SPI that persists the `WorkflowSnapshot` (the
   agent's conversation history, pending tool call, approval ID) to a
   durable backend (SQLite, Redis, Postgres) before the thread parks.
3. **`/__approval/<id>/approve`** REST endpoint that accepts the decision
   out-of-band, loads the snapshot, and resumes execution on the new JVM.

When the new JVM comes up, it rehydrates any pending checkpoints, wires
new `ApprovalStrategy` instances to the same `ApprovalRegistry`, and waits
for the REST callback.

## Wiring the CheckpointStore

Atmosphere ships three `CheckpointStore` implementations:

- **`InMemoryCheckpointStore`** — default; non-durable (lost on restart)
- **`SqliteCheckpointStore`** — file-backed; survives restarts on the same
  host (single-node durability)
- **`RedisCheckpointStore`** — network-backed; survives restarts across a
  fleet (multi-node durability)

Pick SQLite for single-host deployments, Redis for multi-host. Both share
the same SPI, so your agent code doesn't change.

### Spring Boot configuration

```yaml
atmosphere:
  ai:
    checkpoint:
      store: sqlite
      sqlite:
        path: /var/lib/atmosphere/checkpoints.db
```

Or for Redis:

```yaml
atmosphere:
  ai:
    checkpoint:
      store: redis
      redis:
        host: redis.internal
        port: 6379
        keyspace: atmosphere:checkpoints
```

The auto-config wires the chosen store to the coordination journal and to
the `ApprovalRegistry` so pending approvals land in the store before the
virtual thread parks.

### Programmatic

```java
var store = new SqliteCheckpointStore(Path.of("/var/lib/atmosphere/checkpoints.db"));
var registry = new ApprovalRegistry(store);  // registry persists via the store

var strategy = ApprovalStrategy.virtualThread(registry);
var context = baseContext.withApprovalStrategy(strategy);
runtime.execute(context, session);
```

## The full flow

```
T+0s    Agent call starts on JVM-A
        ↓
T+0.1s  Model emits tool-call: issueRefund("cust-42", $500)
        ↓
T+0.1s  Runtime bridge invokes ToolExecutionHelper.executeWithApproval
        ↓
T+0.2s  Helper detects @RequiresApproval, writes WorkflowSnapshot to
        CheckpointStore (agentId, toolName, args, approvalId, parentChain)
        ↓
T+0.3s  ApprovalStrategy.virtualThread(registry).awaitApproval()
        parks the current VT on a CountDownLatch keyed by approvalId
        ↓
T+0.3s  Session emits AiEvent.ApprovalRequired to the browser
        ↓
        [ browser renders an approval card with Approve/Deny buttons ]
        [ user is away from the desk — 30 minutes pass ]
        ↓
T+30m   CI pipeline pushes new build, JVM-A terminates
        ↓
T+30m   JVM-B starts, auto-config wires a new SqliteCheckpointStore
        pointing at the same database file, new ApprovalRegistry loads
        all pending snapshots on startup
        ↓
T+45m   User opens the browser, clicks Approve
        ↓
T+45m   Browser POSTs to /__approval/<approvalId>/approve
        ↓
T+45m   AdminController resolves the approval against the registry,
        loads the WorkflowSnapshot from the store, creates a new
        session, reinstates the agent context, and resumes the
        agent at the parked tool call — issueRefund runs, returns,
        the model produces a natural-language confirmation, and the
        session streams the final text to the browser.
```

The user sees a continuous experience. The infrastructure absorbs the
restart without losing state.

## Building the sample step-by-step

Start from the `spring-boot-checkpoint-agent` sample. The key files are:

### `RefundAgent.java` — the @Agent with @RequiresApproval

```java
@Agent
public class RefundAgent {

    @Prompt
    public void handle(String message, StreamingSession session) {
        session.stream(message);
    }

    @AiTool(description = "Issue a refund to a customer account")
    @RequiresApproval(
        message = "Confirm the refund amount and destination account.",
        timeoutSeconds = 3600  // 1h timeout — generous for email round-trip
    )
    public RefundResult issueRefund(String customerId, BigDecimal amount) {
        logger.info("Issuing refund: customer={}, amount={}", customerId, amount);
        return paymentProvider.refund(customerId, amount);
    }
}
```

### `application.yml` — SQLite checkpoint store

```yaml
atmosphere:
  ai:
    checkpoint:
      store: sqlite
      sqlite:
        path: ./data/checkpoints.db
```

### Approval UI on the browser

The console auto-renders the `ApprovalRequired` frame into an approval
card with Approve/Deny buttons. When the user clicks a button, the
console POSTs to:

```
POST /__approval/<approvalId>/approve
POST /__approval/<approvalId>/deny
```

The browser doesn't need to track any state — the REST callback carries
the `approvalId` and the server resolves it against the `ApprovalRegistry`.

### Running the sample

```bash
./mvnw spring-boot:run -pl samples/spring-boot-checkpoint-agent
```

1. Open `http://localhost:8095/atmosphere/console/`
2. Type: `Please refund $500 to customer cust-42`
3. Watch the agent emit `ToolStart` → `ApprovalRequired` → approval card
4. **Before clicking Approve, kill the JVM** (`Ctrl+C` in the terminal)
5. Restart: `./mvnw spring-boot:run -pl samples/spring-boot-checkpoint-agent`
6. Reopen `http://localhost:8095/atmosphere/console/`
7. Click Approve in the card (the console reconnects and the card is
   still visible because the snapshot was loaded from SQLite)
8. Watch the agent resume — `issueRefund` runs on the new JVM, the model
   returns a confirmation, and the final text streams back

This is production-grade HITL. No timer loops, no polling, no client-side
state. The `WorkflowSnapshot` is the source of truth; JVMs come and go.

## Parent-chained snapshots

`WorkflowSnapshot` records a `parentCheckpointId` that links each snapshot
to the one that preceded it. This gives you a **causal history** of every
agent execution as it progresses through approval gates:

```
snapshot-1: @RequiresApproval draft_email(subject, body)
    ↓ parentCheckpointId = snapshot-1
snapshot-2: @RequiresApproval send_email(to, subject, body)
    ↓ parentCheckpointId = snapshot-2
snapshot-3: @RequiresApproval send_receipt(to, txId)
```

You can **fork** a snapshot to explore alternative agent futures without
losing the original chain — useful for eval harnesses and "what if" replay.

## Approval timeout semantics

`@RequiresApproval(timeoutSeconds = N)` sets a wall-clock timeout after
which the approval is auto-denied and the parked thread unblocks with an
`ApprovalTimeoutException`. The default is 300 seconds (5 minutes). Use
longer timeouts for async approval flows (email, Slack, SMS) and shorter
timeouts for interactive flows (console, chat UI).

The timeout is enforced by the `ApprovalRegistry` even across restarts —
when the new JVM rehydrates a snapshot, it checks the wall-clock age of
the approval against the timeout and expires any that are past due.

## Cooperating with `ExecutionHandle.cancel()`

A caller holding an `ExecutionHandle` can cancel an in-flight agent
execution, even one parked on an approval gate. See
[ExecutionHandle](../../reference/execution-handle/) for the full cancel
contract — the short version is:

```java
handle.cancel();  // interrupts the parked VT, fires onError(CancellationException)
```

The snapshot is **not** deleted on cancel — it's left in the store with a
`CANCELLED` state so you have an audit trail.

## When to use durable HITL

- ✅ Compliance workflows (SOX, HIPAA, SOC 2) that require human sign-off
- ✅ Financial flows (refunds, transfers, subscription changes)
- ✅ Content moderation (publish approval, takedown review)
- ✅ Infrastructure changes (database migrations, config rollouts)
- ✅ Anything where a mistake is expensive to reverse

- ❌ Low-stakes read-only queries
- ❌ High-frequency loops where the approval overhead dominates
- ❌ Purely cosmetic decisions (tone of voice, formatting)

## See also

- [ToolApprovalPolicy Reference](../../reference/tool-approval-policy/) — policy variants for the approval gate
- [Durable Checkpoints Reference](../../reference/checkpoint/) — `CheckpointStore` SPI
- [AgentLifecycleListener](../../reference/lifecycle-listener/) — `onToolCall` fires after approval
- [ExecutionHandle](../../reference/execution-handle/) — cancelling across approval gates
- [spring-boot-checkpoint-agent sample](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-checkpoint-agent)
