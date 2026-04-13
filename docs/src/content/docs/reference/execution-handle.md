---
title: "ExecutionHandle"
description: "Cooperative cancellation handle for in-flight @Agent executions — idempotent cancel, terminal whenDone future, and cross-runtime cancel semantics"
---

# ExecutionHandle

Cooperative cancellation handle returned by
`AgentRuntime.executeWithHandle(context, session)`. Phase 2 of the unified
`@Agent` API closes Correctness Invariant #2 (Terminal Path Completeness) by
giving callers a first-class way to abort an in-flight chat completion. The
handle wraps each runtime's native cancel primitive so the same external API
cancels any backend.

## Interface

```java
public interface ExecutionHandle {

    /**
     * Request cancellation of the in-flight execution. Idempotent — subsequent
     * calls are no-ops. Implementations fire the runtime's native cancel
     * primitive and complete whenDone() once the native pipeline has observed
     * the cancellation.
     */
    void cancel();

    /** @return true once the execution has terminated (completion, error, cancel). */
    boolean isDone();

    /**
     * @return a future that resolves when the execution terminates.
     * Consumers can chain resource cleanup on this without blocking.
     */
    CompletableFuture<Void> whenDone();
}
```

## Runtime cancel primitives

Each adapter wraps its framework's native cancel mechanism so a single
`handle.cancel()` call does the right thing on any backend:

| Runtime | Native primitive | Hard cancel |
|---------|------------------|:-----------:|
| Built-in        | `HttpClient` request + SSE `InputStream.close()` | ✅ true HTTP-level cancel |
| Spring AI       | `reactor.core.Disposable.dispose()` on the streaming `Flux` | ✅ Reactor disposal |
| LangChain4j     | `CompletableFuture.completeExceptionally(CancellationException)` + `AtomicBoolean` soft-cancel flag consulted in the streaming response handler | ⚠️ caller-side unblock; underlying HTTP drains naturally |
| Google ADK      | `AdkEventAdapter.cancel()` → `io.reactivex.rxjava3.disposables.Disposable.dispose()` on the Runner subscription | ✅ RxJava3 disposal |
| JetBrains Koog  | `AtomicReference<Job>` captured by `executeInternal` → `Job.cancel()` + virtual-thread `Thread.interrupt()` belt-and-suspenders + immediate `done.complete(null)` fallback | ✅ coroutine cancel |
| Semantic Kernel | **None**. `SemanticKernelAgentRuntime` does not override `doExecuteWithHandle`, so it inherits `AbstractAgentRuntime`'s default which calls `doExecute(...)` and returns the `ExecutionHandle.completed()` sentinel. `handle.cancel()` is a no-op. | — |
| Embabel         | **None**. `EmbabelAgentRuntime` does not override `executeWithHandle`, so it inherits the `AgentRuntime` interface default which calls `execute(...)` and returns the `ExecutionHandle.completed()` sentinel. `handle.cancel()` is a no-op. | — |

"Hard cancel" means the underlying HTTP request, coroutine, or Reactor/RxJava
subscription is actually torn down. "Caller-side unblock" means the caller
sees cancellation immediately but the runtime's internal thread continues
draining the stream until the LLM finishes — token budgets may still be
consumed. **None** means no cancel primitive is wired and `cancel()` is an
idempotent no-op — a known gap for Embabel and Semantic Kernel.

## Usage

```java
var handle = runtime.executeWithHandle(context, session);

// The execution runs asynchronously. Do other work.
doSomethingElse();

// User hits Cancel in the UI — abort the LLM call
handle.cancel();

// Wait for the runtime to fully release resources before continuing
handle.whenDone().whenComplete((result, error) -> {
    if (error instanceof CancellationException) {
        logger.info("Agent execution cancelled");
    } else if (error != null) {
        logger.error("Agent execution failed", error);
    } else {
        logger.info("Agent execution completed normally");
    }
    cleanupSessionResources();
});
```

`cancel()` is idempotent and thread-safe — it's safe to call from any
thread, including the completion callback itself. `whenDone()` returns the
same future on every call and is also safe to chain from any thread.

## Terminal-reason race

`CompletableFuture` is first-write-wins. If `cancel()` and a natural
completion (either success or error) race each other, observers chained on
`whenDone()` see whichever fired first:

- `cancel()` wins → future completes with `CancellationException`
- natural completion wins → future completes normally or with the runtime's error

**A real error that arrives strictly after `cancel()` is silently dropped.**
If your telemetry needs to distinguish "cancelled by caller" from "errored
after cancel arrived," check `isCancelled()` explicitly inside your
`whenComplete` callback:

```java
handle.whenDone().whenComplete((result, error) -> {
    if (handle.isCancelled()) {
        // Caller explicitly cancelled — may or may not have also seen an error
        recordCancellation();
    } else if (error != null) {
        recordError(error);
    } else {
        recordSuccess();
    }
});
```

Never rely on the exception type alone — `CancellationException` could
arrive because the caller cancelled OR because a downstream stage (e.g.
LC4j's internal future) completed exceptionally with that type.

## `ExecutionHandle.completed()`

Runtimes that don't override `executeWithHandle` return a sentinel already-
terminated handle:

```java
static ExecutionHandle completed() { return COMPLETED; }
```

- `cancel()` → no-op
- `isDone()` → `true`
- `whenDone()` → already-completed future

Use it when you're wrapping a synchronous API and want to preserve the
`ExecutionHandle` return type without adding real cancel support.

## `ExecutionHandle.Settable` — CAS-guarded cancel flag

For runtimes that only need a simple cancel flag + completion future,
`ExecutionHandle.Settable` gives you a ready-made implementation:

```java
public final class Settable implements ExecutionHandle {
    private final CompletableFuture<Void> done = new CompletableFuture<>();
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private final Runnable nativeCancel;  // may be null

    public Settable(Runnable nativeCancel) {
        this.nativeCancel = nativeCancel;
    }

    @Override
    public void cancel() {
        if (cancelled.compareAndSet(false, true)) {
            if (nativeCancel != null) {
                nativeCancel.run();  // fire the runtime's native primitive
            }
        }
    }

    public void complete() { done.complete(null); }
    public void completeExceptionally(Throwable error) { done.completeExceptionally(error); }
    public boolean isCancelled() { return cancelled.get(); }

    @Override public boolean isDone() { return done.isDone(); }
    @Override public CompletableFuture<Void> whenDone() { return done; }
}
```

Runtimes that have a richer native cancel primitive should wrap it
directly instead of using `Settable` — for example, Koog stores the
`runBlocking` `Job` reference and cancels it, ADK disposes the
`Flux` subscription, Built-in closes the HTTP `InputStream`.

## Integration with approval gates

`ExecutionHandle.cancel()` cooperates with `@RequiresApproval`:

- Tool sits in the approval queue waiting on `ApprovalStrategy.virtualThread()`
- User hits Cancel instead of Approve/Deny
- `handle.cancel()` fires
- The virtual thread parked on the approval is interrupted
- The tool is rejected with "execution cancelled"
- `onError(CancellationException)` fires on lifecycle listeners
- `whenDone()` completes with `CancellationException`

See [Durable Checkpoints](../checkpoint/) for the pattern where an
approval arrives across a process restart — the `ExecutionHandle` is
discarded on the original process and a new one is created on the
resuming process.

## Testing

`OpenAiCompatibleClientCancelTest` exercises the full cancel path against a
local HTTP server that returns SSE tokens slowly. The test asserts:

1. `handle.cancel()` returns immediately
2. `handle.whenDone()` completes within a bounded window
3. The HTTP connection is closed (server observes disconnect)
4. `isCancelled()` returns `true` on the handle
5. Subsequent `cancel()` calls are no-ops

For a cross-runtime cancel contract, see `AbstractAgentRuntimeContractTest`
which asserts the cancel path on each adapter's subclass.

## See also

- [AI / LLM Reference](../ai/) — `AgentRuntime.executeWithHandle()`
- [AgentLifecycleListener](../lifecycle-listener/) — `onError(CancellationException)` semantics
- [ToolApprovalPolicy](../tool-approval-policy/) — cancelling across approval gates
