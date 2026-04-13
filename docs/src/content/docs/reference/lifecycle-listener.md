---
title: "AgentLifecycleListener"
description: "Server-side lifecycle observer for @Agent executions — onStart, onToolCall, onToolResult, onCompletion, onError"
---

# AgentLifecycleListener

Server-side lifecycle observer for an `AgentRuntime` execution. Phase 3 of
the unified `@Agent` API promotes the ad-hoc logging and metric hooks
scattered across runtime bridges into a single listener interface that
mirrors how `AtmosphereResourceEventListener` works in the real-time core.

Use it for **observability, audit, metrics, and session-state reconstruction**
— not for behavior modification. Listeners run synchronously on the runtime's
execution thread and exceptions from any listener are caught and ignored so a
broken listener cannot abort the pipeline.

## Interface

```java
public interface AgentLifecycleListener {

    /** Fired once at the start of an execution, before any model call. */
    default void onStart(AgentExecutionContext context) { }

    /**
     * Fired when the model asks for a tool invocation. arguments is the
     * decoded JSON argument map the runtime is about to pass to the tool.
     */
    default void onToolCall(String toolName, Map<String, Object> arguments) { }

    /**
     * Fired when a tool invocation has produced a result (or error string).
     * resultPreview is a short string suitable for logs.
     */
    default void onToolResult(String toolName, String resultPreview) { }

    /** Fired once when the runtime calls session.complete(). */
    default void onCompletion(AgentExecutionContext context) { }

    /** Fired when the runtime reports an error on the streaming session. */
    default void onError(AgentExecutionContext context, Throwable error) { }
}
```

All methods are `default` no-ops — subclass and override only what you care
about. Listeners attach to an `AgentExecutionContext` and fire in FIFO order
around the runtime's native event stream.

## Event ordering

```
onStart()
  ↓
onToolCall("get_weather", {"city": "Montreal"})   // for each tool invocation
onToolResult("get_weather", "{\"temp\": 22}")
  ↓
onCompletion()           // on successful session.complete()
  OR
onError(Throwable)       // on session.error(...)
```

`onToolCall` and `onToolResult` fire once per tool invocation inside the
tool-call loop. Multiple round-trips with different tools produce alternating
`onToolCall`/`onToolResult` pairs.

`onCompletion` and `onError` are terminal and mutually exclusive — exactly
one fires per execution unless the caller cancels via `ExecutionHandle`.

## Attaching listeners

Listeners are attached through `AgentExecutionContext.withListeners()`:

```java
var auditListener = new AgentLifecycleListener() {
    @Override
    public void onToolCall(String toolName, Map<String, Object> arguments) {
        logger.info("Tool invoked: {} with args {}", toolName, arguments);
    }

    @Override
    public void onToolResult(String toolName, String resultPreview) {
        logger.info("Tool result: {} → {}", toolName, resultPreview);
    }
};

var metricsListener = new AgentLifecycleListener() {
    @Override
    public void onStart(AgentExecutionContext ctx) {
        meterRegistry.counter("ai.execution.start", "agent", ctx.agentId()).increment();
    }

    @Override
    public void onCompletion(AgentExecutionContext ctx) {
        meterRegistry.counter("ai.execution.complete", "agent", ctx.agentId()).increment();
    }

    @Override
    public void onError(AgentExecutionContext ctx, Throwable error) {
        meterRegistry.counter("ai.execution.error",
                "agent", ctx.agentId(),
                "type", error.getClass().getSimpleName()).increment();
    }
};

var context = baseContext.withListeners(List.of(auditListener, metricsListener));
runtime.execute(context, session);
```

Listeners fire in list order. You can chain multiple listeners for different
concerns (audit, metrics, tracing, debug logging) without any one interfering
with another.

## Runtime coverage

Every tool-calling `AgentRuntime` bridge fires `onToolCall` and `onToolResult`
through the `AgentLifecycleListener.fireToolCall()` /
`fireToolResult()` static dispatch helpers. The helpers catch and swallow any
exception so one broken listener cannot abort the pipeline (Correctness
Invariant #2 — Terminal Path Completeness).

| Runtime | `onStart` | `onToolCall` | `onToolResult` | `onCompletion` | `onError` |
|---------|:---------:|:------------:|:--------------:|:--------------:|:---------:|
| Built-in        | ✅ | ✅ | ✅ | ✅ | ✅ |
| Spring AI       | ✅ | ✅ | ✅ | ✅ | ✅ |
| LangChain4j     | ✅ | ✅ | ✅ | ✅ | ✅ |
| Google ADK      | ✅ | ✅ | ✅ | ✅ | ✅ |
| JetBrains Koog  | ✅ | ✅ | ✅ | ✅ | ✅ |
| Embabel         | ✅ |  —  |  —  | ✅ | ✅ |
| Semantic Kernel | ✅ | ⚠️ | ⚠️ | ✅ | ✅ |

Embabel has no tool-calling path — `onToolCall`/`onToolResult` never fire.
Semantic Kernel's tool-calling is deferred in 4.0.36 (documented in the
`modules/semantic-kernel/README.md` exclusion note).

## Listener error isolation

Listener methods run **synchronously on the runtime's execution thread**, so
a long-blocking `onToolCall` can stall the stream. Keep work minimal:

- ✅ Log the event (structured or plain)
- ✅ Increment a Micrometer counter / OpenTelemetry span attribute
- ✅ Publish to an async queue for offline processing
- ❌ Block on a remote HTTP call
- ❌ Acquire locks that other threads may hold
- ❌ Throw exceptions intentionally

If you need async processing, push the event into a `BlockingQueue` and
drain it on a dedicated worker thread. The listener itself stays
non-blocking.

Exceptions thrown from a listener are caught by the framework's
`fireToolCall`/`fireToolResult` helpers and silently dropped — they never
abort the execution pipeline. This is intentional: one broken listener must
not terminate an in-flight agent execution.

## Use cases

### Audit logging

Write every tool call to an immutable audit log for compliance:

```java
public class ToolAuditListener implements AgentLifecycleListener {
    private final AuditLog log;

    @Override
    public void onToolCall(String toolName, Map<String, Object> args) {
        log.append(new AuditEntry(
                Instant.now(), "tool_call", toolName, args));
    }

    @Override
    public void onToolResult(String toolName, String resultPreview) {
        log.append(new AuditEntry(
                Instant.now(), "tool_result", toolName, Map.of("preview", resultPreview)));
    }
}
```

### Prometheus / Micrometer metrics

```java
public class ToolMetricsListener implements AgentLifecycleListener {
    private final MeterRegistry registry;

    @Override
    public void onToolCall(String toolName, Map<String, Object> args) {
        registry.counter("ai.tool.calls", "tool", toolName).increment();
    }

    @Override
    public void onToolResult(String toolName, String resultPreview) {
        registry.counter("ai.tool.results", "tool", toolName).increment();
    }
}
```

### OpenTelemetry span decoration

```java
public class OtelTraceListener implements AgentLifecycleListener {
    @Override
    public void onStart(AgentExecutionContext ctx) {
        Span.current().setAttribute("ai.agent.id", ctx.agentId());
        Span.current().setAttribute("ai.session.id", ctx.sessionId());
    }

    @Override
    public void onToolCall(String toolName, Map<String, Object> args) {
        Span.current().addEvent("ai.tool.call", Attributes.of(
                AttributeKey.stringKey("tool.name"), toolName));
    }
}
```

### State rebuild from event stream

Rebuild session state from `onToolCall`/`onToolResult` events for offline
replay, debugging, or eval harnesses. See
[AI Testing](../testing/) for the `LlmJudge` pattern using listeners.

## Testing

The `AiTestClient` in `atmosphere-ai-test` exposes a capturing listener for
assertions:

```java
var captured = new CapturingLifecycleListener();
var context = testContext.withListeners(List.of(captured));
runtime.execute(context, session);

assertThat(captured.toolCalls()).containsExactly("get_weather");
assertThat(captured.toolResults()).hasSize(1);
assertThat(captured.completed()).isTrue();
```

See [AI Testing](../testing/) for the full contract test surface.

## See also

- [AI / LLM Reference](../ai/) — `AgentExecutionContext` record layout
- [ExecutionHandle](../execution-handle/) — cooperative cancel semantics
- [Observability](../observability/) — wiring listeners into OpenTelemetry and Micrometer
- [AI Testing](../testing/) — `CapturingLifecycleListener` and `LlmJudge`
