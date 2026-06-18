---
title: "ToolApprovalPolicy"
description: "Sealed interface controlling which @AiTool invocations pass through the HITL approval gate — AllowAll, DenyAll, Annotated (default), Custom"
---

# ToolApprovalPolicy

Phase 6 of the unified `@Agent` API promotes the implicit "every tool with
`@RequiresApproval`" behavior into a first-class policy on
`AgentExecutionContext`. Use it when you need to:

- **Allow every tool** unconditionally (trusted test harnesses).
- **Deny every tool** unconditionally (shadow / preview mode — no invocation ever runs).
- **Keep the annotation-driven default** — honor `@RequiresApproval` exactly as declared.
- **Provide a custom predicate** that inspects the tool at runtime.

`ToolApprovalPolicy` is a **sealed interface** with four permitted
implementations — the compiler guarantees no fifth case can sneak in.

## Interface

```java
public sealed interface ToolApprovalPolicy {

    /**
     * @return true when the given tool invocation must pass through
     *         the approval gate before running its executor.
     */
    boolean requiresApproval(ToolDefinition tool);

    /** The annotation-driven default: honors @RequiresApproval. */
    static ToolApprovalPolicy annotated();

    /** Allow every tool through without gating (e.g. trusted test fixtures). */
    static ToolApprovalPolicy allowAll();

    /** Deny every tool (no invocation ever runs — preview/shadow mode). */
    static ToolApprovalPolicy denyAll();

    /** Custom predicate evaluated per tool at invocation time. */
    static ToolApprovalPolicy custom(Predicate<ToolDefinition> predicate);
}
```

## The four policies

### `ToolApprovalPolicy.annotated()` — default

Honors the `@RequiresApproval` annotation on each `@AiTool` method. This is
the policy every runtime bridge uses when `context.approvalPolicy()` is not
set — it reproduces the Phase 0 behavior byte-for-byte.

```java
@AiTool(description = "Get the weather for a city")
public WeatherReport getWeather(String city) { ... }
// → never gated

@AiTool(description = "Delete all customer data")
@RequiresApproval(message = "This permanently deletes customer records.")
public Result deleteAllCustomers() { ... }
// → always gated through the session-scoped ApprovalStrategy
```

Use this in production by default. Callers opt into stricter or looser
behavior via one of the other three policies below.

### `ToolApprovalPolicy.allowAll()` — trusted test fixtures

Every tool runs without consulting the approval gate. Use this in unit tests,
integration tests, and local dev harnesses where you want to exercise the
full tool-call loop without approval prompts.

```java
var testContext = baseContext.withApprovalPolicy(ToolApprovalPolicy.allowAll());
runtime.execute(testContext, session);
// → deleteAllCustomers() runs without ever prompting
```

**Never use this in production.** `AllowAll` disables the HITL gate
completely, including tools that are marked `@RequiresApproval`. The
production default should always be `annotated()`.

### `ToolApprovalPolicy.denyAll()` — preview / shadow mode

Every tool invocation is rejected before the approval strategy is even
consulted. Use this for **dry-run / preview / shadow mode** where you want
to see what the model would call without actually running anything.

```java
var previewContext = baseContext.withApprovalPolicy(ToolApprovalPolicy.denyAll());
runtime.execute(previewContext, session);
// → every tool call returns {"status":"cancelled","message":"Tool execution denied by policy"}
// → the model sees the cancellation and can choose to respond without tool results
```

`DenyAll` **short-circuits before the approval gate fires** — the session-
scoped `ApprovalStrategy` is never consulted, so even an auto-approve
strategy cannot override it. This closes a P0 security bug from the review
pass where `DenyAll` delegated to the strategy and an auto-approve strategy
could silently run the tool.

**Correctness note**: `DenyAll.requiresApproval()` returns `true`, which
previously entered the approval gate. The fix in
`ToolExecutionHelper.executeWithApproval` now detects `DenyAll` specifically
and returns the cancelled-by-policy JSON immediately without consulting the
strategy.

### `ToolApprovalPolicy.custom(predicate)` — per-tool dynamic decisions

Caller-supplied predicate evaluated at every tool invocation. Use this when
the approval requirement depends on runtime state — user role, budget,
feature flags, recent activity, etc.

```java
var adminPolicy = ToolApprovalPolicy.custom(tool -> {
    if (currentUser.isAdmin()) return false;          // admins skip approval
    if (tool.name().startsWith("read_")) return false;// read-only tools skip approval
    if (isWithinDailyBudget()) return false;          // tools under budget skip approval
    return true;                                       // everything else needs approval
});

var context = baseContext.withApprovalPolicy(adminPolicy);
runtime.execute(context, session);
```

The predicate **must be non-null and thread-safe** — it runs on every tool
invocation across potentially many virtual threads. Avoid capturing mutable
state; pass thread-safe dependencies by reference.

## Attaching a policy

Via the `AgentExecutionContext` wither:

```java
var context = new AgentExecutionContext(...)
        .withApprovalPolicy(ToolApprovalPolicy.denyAll());
```

Or via the Spring Boot / Quarkus auto-config bean:

```java
@Bean
ToolApprovalPolicy appApprovalPolicy() {
    return ToolApprovalPolicy.custom(tool ->
            !SecurityContextHolder.getContext().getAuthentication().hasRole("ADMIN"));
}
```

When no policy is explicitly attached, the pipeline defaults to
`ToolApprovalPolicy.annotated()` — identical to Phase 0 behavior.

## How runtimes consume the policy

Every runtime bridge threads `context.approvalPolicy()` into its tool-call
loop and passes it to `ToolExecutionHelper.executeWithApproval()`. The helper
checks the policy before consulting the session-scoped `ApprovalStrategy`:

```
Tool invocation arrives
       │
       ▼
  policy.requiresApproval(tool)?
       │
       ├─ false → run the executor directly, return result
       │
       └─ true ──→ policy instanceof DenyAll?
                        │
                        ├─ true → return "cancelled by policy", skip strategy
                        │
                        └─ false → park virtual thread on
                                   ApprovalStrategy.virtualThread(registry)
                                   │
                                   ├─ APPROVED → run executor, return result
                                   └─ DENIED   → return "denied by user"
```

## Runtime coverage

All five tool-calling runtimes thread `context.approvalPolicy()` through
their bridges and into `ToolExecutionHelper.executeWithApproval`:

| Runtime | Threads policy | Notes |
|---------|:--------------:|-------|
| Built-in        | ✅ | `ChatCompletionRequest.approvalPolicy` (13th canonical field) |
| Spring AI       | ✅ | `SpringAiToolBridge` 6-arg `executeWithApproval` |
| LangChain4j     | ✅ | `ToolAwareStreamingResponseHandler` 6-arg `executeWithApproval` |
| Google ADK      | ✅ | `AdkToolBridge` 6-arg `executeWithApproval` |
| JetBrains Koog  | ✅ | `AtmosphereToolBridge` 6-arg `executeWithApproval` |
| Embabel         |  —  | No tool-calling path |
| Semantic Kernel |  —  | Tool-calling deferred in 4.0.36 |

Tool-loop reconstruction across rounds preserves the policy — round 2 of a
multi-tool execution sees the same `approvalPolicy` as round 1.

## Integration with HITL approval

The policy runs **before** the approval gate. If a policy allows a tool,
the gate never fires. If a policy denies a tool, the gate never fires
either. If the policy defers (`annotated()` + `@RequiresApproval`), the gate
fires and the session-scoped `ApprovalStrategy` decides:

- `ApprovalStrategy.autoApprove()` — approve every gated call (tests)
- `ApprovalStrategy.autoDeny()` — deny every gated call
- `ApprovalStrategy.virtualThread(registry)` — park a virtual thread until
  a user sends `/__approval/<id>/approve` or `/deny` across the wire

See [AI / LLM Reference — HITL approval](../ai/#hitl-approval) for the full
wire protocol and [Durable Checkpoints](../checkpoint/) for approvals that
survive process restarts.

## Testing

```java
@Test
void denyAllSkipsApprovalGate() {
    var tool = ToolDefinition.builder()
            .name("dangerous_tool")
            .executor(args -> { throw new AssertionError("must not run"); })
            .requiresApproval(true)
            .build();

    var context = testContext()
            .withApprovalPolicy(ToolApprovalPolicy.denyAll());

    // Signature: (toolName, tool, args, session, strategy, policy)
    var result = ToolExecutionHelper.executeWithApproval(
            tool.name(), tool, Map.of(),
            testSession,                        // streaming session sink
            ApprovalStrategy.autoApprove(),     // strategy should NEVER fire
            context.approvalPolicy());          // DenyAll short-circuits before strategy

    assertThat(result).contains("\"status\":\"cancelled\"");
    // Tool executor never ran — the AssertionError is never thrown
}
```

Contract assertions in `AbstractAgentRuntimeContractTest` exercise every
runtime subclass against the four policy variants through
`hitlPendingApprovalEmitsProtocolEvent` and related assertions.

## See also

- [AI / LLM Reference](../ai/) — HITL approval wire protocol
- [AgentLifecycleListener](../lifecycle-listener/) — `onToolCall` fires after policy check
- [Durable Checkpoints](../checkpoint/) — approvals that survive process restarts

## Source

- Source: [`ToolApprovalPolicy.java`](https://github.com/Atmosphere/atmosphere/blob/main/modules/ai/src/main/java/org/atmosphere/ai/approval/ToolApprovalPolicy.java)
