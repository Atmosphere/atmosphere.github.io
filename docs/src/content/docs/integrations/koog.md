---
title: "JetBrains Koog"
description: "AgentRuntime backed by JetBrains Koog — Kotlin-native AI framework with structured concurrency and tool calling"
---

# JetBrains Koog Adapter

`AgentRuntime` implementation backed by [JetBrains Koog](https://github.com/JetBrains/koog), a Kotlin-native AI framework with structured concurrency, typed tools, and a composable agent DSL. When the `atmosphere-koog` JAR is on the classpath, `@AiEndpoint` and `@AiTool` work across Koog agents without code changes.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-koog</artifactId>
    <version>${project.version}</version>
</dependency>
```

## Quick Start

### AgentRuntime SPI (auto-detected)

Drop the dependency alongside `atmosphere-ai` and the framework auto-selects Koog via `ServiceLoader`:

```java
@AiEndpoint(path = "/ai/chat", systemPrompt = "You are a helpful assistant")
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // uses Koog when atmosphere-koog is on classpath
    }
}
```

No code changes needed — the `KoogAgentRuntime` implementation declares a priority that wins when framework-native runtimes are not wired.

### Programmatic Koog executor

For full control over the Koog `PromptExecutor` and `AIAgent` configuration:

```kotlin
val executor = OpenRouterLLMClient(
    apiKey = System.getenv("LLM_API_KEY"),
    baseUrl = "https://openrouter.ai/api/v1"
)
KoogAgentRuntime.setPromptExecutor(executor)
KoogAgentRuntime.setModel(OpenAIModels.Chat.GPT_4o_Mini)
```

Once the executor and model are set, every `@AiEndpoint` call routes through Koog's streaming `executeStreaming(prompt, model)` or through a full `AIAgent.run()` when tools are present.

## How It Works

`KoogAgentRuntime` runs the Koog pipeline inside a `runBlocking { }` block on a dedicated virtual thread. Two execution paths:

- **Tool-aware path** — when `context.tools()` is non-empty, the runtime builds a Koog `ToolRegistry` via `AtmosphereToolBridge`, constructs an `AIAgent`, and calls `agent.run(message)`. Tool invocations flow through `ToolExecutionHelper.executeWithApproval()` so `@RequiresApproval` gates HITL approval just like every other runtime.
- **Streaming path** — when no tools are registered, the runtime calls `executor.executeStreaming(prompt, model).collect { frame -> session.send(frame.text) }` for minimal-overhead text streaming.

Both paths fire `AgentLifecycleListener.onStart` / `onToolCall` / `onToolResult` / `onCompletion` / `onError` for full observability parity with the other runtimes.

## Cooperative cancellation

`KoogAgentRuntime.executeWithHandle()` captures `coroutineContext[Job]` inside the `runBlocking` block and stores it in an `AtomicReference`. On `handle.cancel()`, the adapter calls `activeJob.get()?.cancel()` which propagates `CancellationException` through Koog's coroutine machinery and unblocks the `runBlocking` wrapper.

See [ExecutionHandle](../../reference/execution-handle/) for the full cancel contract.

## Key Classes

| Class | Purpose |
|-------|---------|
| `KoogAgentRuntime` | `AgentRuntime` SPI implementation |
| `AtmosphereToolBridge` | Converts `ToolDefinition` → Koog `ToolDescriptor` + `ToolRegistry` with approval-gate hooks |

## Capability matrix

This mirrors `KoogAgentRuntime.capabilities()` exactly — runtime truth, not
aspiration.

| Capability | Status | Notes |
|------------|:------:|-------|
| `TEXT_STREAMING` | ✅ | `executeStreaming` flow + `AIAgent.run()` |
| `TOOL_CALLING`   | ✅ | `AtmosphereToolBridge` builds the Koog `ToolRegistry` |
| `TOOL_APPROVAL`  | ✅ | Every tool routes through `ToolExecutionHelper.executeWithApproval` |
| `STRUCTURED_OUTPUT` | ✅ | System-prompt schema injection via the pipeline layer |
| `SYSTEM_PROMPT` | ✅ | Honored by the Koog prompt builder |
| `CONVERSATION_MEMORY` | ✅ | Per-session memory threaded through `AgentExecutionContext` |
| `AGENT_ORCHESTRATION` | ✅ | Works with `@Coordinator` and `@Fleet` |
| `TOKEN_USAGE` | ✅ | The `StreamFrame.End` handler reads Koog's usage totals and emits a typed `TokenUsage` record via `session.usage()` after drain (`executeWithAgent` lines 223-232). |
| `VISION` | ✅ | Koog 0.8.0 accepts `ContentPart.Image` natively via `buildPrompt`'s `user(String, List<ContentPart>)` overload (no-tools path) |
| `AUDIO` | ✅ | Same path as `VISION` — `ContentPart.Audio` attached via `AttachmentContent.Binary.Base64` |
| `MULTI_MODAL` | ✅ | Combined image + audio + text inputs work on the no-tools path; tools + multi-modal degrade gracefully (the tool path wins with a WARN — `AIAgent.run(String)` only accepts plain text) |
| `PROMPT_CACHING` | ✅ | Koog 0.8.0 honors Bedrock-specific `CacheControl.Bedrock.{FiveMinutes, OneHour}` mapped from Atmosphere's portable `CacheHint`. Non-Bedrock providers silently drop the cache control — same shape Spring AI / LC4j take for OpenAI `prompt_cache_key`. |
| `CANCELLATION` | ✅ | `executeWithHandle` returns an `ExecutionHandle` whose `cancel()` calls `Job.cancel()` + `Thread.interrupt()` + resolves the done-future with synthetic completion (terminal-path closure per Correctness Invariant #2) |
| `PER_REQUEST_RETRY` | ✅ | Honored via `executeWithOuterRetry` which wraps `executeInternal` in a retry loop respecting `context.retryPolicy()`. Pre-stream transient failures retry on top of Koog's native HTTP retry. |

Exclusions are **honest** — Koog declares them as absent in its `capabilities()` set so runtime-truth advertising is accurate (Correctness Invariant #5). When Koog upstream adds these surfaces in a future release, the bridge will honor them without a breaking change. No `KoogEmbeddingRuntime` ships today — if you need Koog-backed embeddings, wire a Spring AI or LangChain4j `EmbeddingModel` alongside the Koog agent runtime.

## Samples

- [spring-boot-ai-chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) — swap to Koog by adding `atmosphere-koog` to `pom.xml`; the same `@AiEndpoint` code routes through `KoogAgentRuntime` (Atmosphere's SPI promise)
- [spring-boot-ai-classroom](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-classroom) — multi-room shared AI; same one-Maven-dep swap to route through Koog

## See Also

- [AI Reference](../../reference/ai/) — `AgentRuntime` SPI, capability matrix
- [Spring AI Adapter](spring-ai/)
- [LangChain4j Adapter](langchain4j/)
- [Google ADK Adapter](adk/)
- [Embabel Adapter](embabel/)
- [Semantic Kernel Adapter](semantic-kernel/)
