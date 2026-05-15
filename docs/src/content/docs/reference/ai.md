---
title: "AI / LLM"
description: "@AiEndpoint, StreamingSession, AgentRuntime SPI, tool calling, filters"
---

# AI / LLM Integration

AI/LLM streaming module for Atmosphere. Provides `@AiEndpoint`, `@Prompt`, `StreamingSession`, the `AgentRuntime` SPI for auto-detected AI framework adapters, and a built-in `OpenAiCompatibleClient` that works with Gemini, OpenAI, Ollama, and any OpenAI-compatible API.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-ai</artifactId>
    <version>${project.version}</version>
</dependency>
```

## Architecture

Atmosphere has two pluggable SPI layers. `AsyncSupport` adapts web containers — Jetty, Tomcat, Undertow. `AgentRuntime` adapts AI frameworks across all nine runtimes (Built-in, Spring AI, LangChain4j, Google ADK, Embabel, Koog, Semantic Kernel, AgentScope, Spring AI Alibaba). Same design pattern, same discovery mechanism:

| Concern | Transport layer | AI layer |
|---------|----------------|----------|
| SPI interface | `AsyncSupport` | `AgentRuntime` |
| What it adapts | Web containers (Jetty, Tomcat, Undertow) | AI frameworks (all nine `AgentRuntime` adapters) |
| Discovery | Classpath scanning | `ServiceLoader` |
| Resolution | Best available container | Highest `priority()` among `isAvailable()` |
| Initialization | `init(ServletConfig)` | `configure(LlmSettings)` |
| Core method | `service(req, res)` | `execute(AgentExecutionContext, StreamingSession)` |
| Fallback | `BlockingIOCometSupport` | Built-in `AgentRuntime` (OpenAI-compatible) |

This is the **Servlet model for AI agents**: write your `@Agent` once, run it on any supported `AgentRuntime` — determined by classpath.

## Quick Start -- @AiEndpoint

```java
@AiEndpoint(path = "/ai/chat",
            systemPrompt = "You are a helpful assistant",
            conversationMemory = true)
public class MyChatBot {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // auto-detects the best available AgentRuntime from classpath
    }
}
```

The `@AiEndpoint` annotation replaces the boilerplate of `@ManagedService` + `@Ready` + `@Disconnect` + `@Message` for AI streaming use cases. The `@Prompt` method runs on a virtual thread.

`session.stream(message)` auto-detects the best available `AgentRuntime` implementation via `ServiceLoader` — drop an adapter JAR on the classpath and it just works.

## AgentRuntime SPI

The `AgentRuntime` SPI dispatches the entire agent loop — tool calling, memory, RAG, retries — to the AI framework on the classpath. When multiple implementations are available, the one with the highest `priority()` that reports `isAvailable()` wins.

```java
public interface AgentRuntime {
    String name();                                    // e.g. "langchain4j", "spring-ai"
    boolean isAvailable();                            // checks classpath dependencies
    int priority();                                   // higher wins
    void configure(AiConfig.LlmSettings settings);   // called once after resolution
    Set<AiCapability> capabilities();                 // feature discovery
    void execute(AgentExecutionContext context, StreamingSession session);  // full agent loop
}
```

| Classpath JAR | Auto-detected `AgentRuntime` | Priority |
|---------------|------------------------------|----------|
| `atmosphere-ai` (default) | Built-in `OpenAiCompatibleClient` (Gemini, OpenAI, Ollama) | 0 |
| `atmosphere-spring-ai` | Spring AI `ChatClient` | 100 |
| `atmosphere-langchain4j` | LangChain4j `StreamingChatLanguageModel` | 100 |
| `atmosphere-adk` | Google ADK `Runner` | 100 |
| `atmosphere-embabel` | Embabel `AgentPlatform` | 100 |
| `atmosphere-koog` | JetBrains Koog `AIAgent` | 100 |
| `atmosphere-semantic-kernel` | Microsoft Semantic Kernel `ChatCompletionService` | 100 |
| `atmosphere-agentscope` | Alibaba AgentScope `ReActAgent` | 100 |
| `atmosphere-spring-ai-alibaba` | Spring AI Alibaba `ReactAgent` *(see runtime caveat below)* | 100 |

To switch runtimes, change a single Maven dependency — no code changes needed.

> **Spring AI Alibaba runtime — Spring Boot 3 only today.** Spring AI Alibaba `1.1.2.2` is compiled against Spring AI `1.1.2`, and `spring-ai-alibaba-graph-core-1.1.2.x` hardcodes Spring AI 1.1.2-only types like `DeepSeekAssistantMessage`, so the runtime requires Spring AI 1.1.2. Spring AI 1.1.2 itself requires Spring Boot 3 — it pins the SB3-era FQN of `RestClientAutoConfiguration`, which Spring Boot 4 ships at a renamed FQN. Drop `atmosphere-spring-ai-alibaba` into a Spring Boot 3 sample (e.g. `samples/spring-boot-ai-chat -Pspring-boot3`) and it round-trips end-to-end (verified via chrome-devtools against Ollama). A Spring Boot 4 path will become possible once Alibaba publishes a Spring AI 2.x-aligned `spring-ai-alibaba-agent-framework`. `atmosphere-agentscope` is unaffected and works on Spring Boot 4.

### Per-Request Runtime Extensions

Each `AgentRuntime` runs its framework's "happy path" by default. For requests
that need framework-native composition (Spring AI advisor chain, LangChain4j
`AiServices`, Koog graph DSL, ADK multi-agent topology), a small per-request
helper attaches the framework-native object to `AgentExecutionContext.metadata()`
and the runtime applies it for that one call — no `AgentRuntime` SPI growth, no
mutation of shared beans. Every helper follows the `CacheHint` pattern:
`from(context)` and `attach(context, ...)` static methods, with strict type
checking that throws `IllegalArgumentException` on a wrong-type slot (silent
drops would mask the override never firing).

| Helper | Runtime | Slot it drives |
|--------|---------|----------------|
| `SpringAiAdvisors` | Spring AI | `ChatClient.prompt().advisors(...)` — RAG, memory, guardrails, observability (additive — multiple advisors compose into a chain) |
| `LangChain4jAiServices` | LangChain4j | Routes through caller's `AiServices`-backed interface (`TokenStream` callbacks bridged to session) — gives access to `maxSequentialToolsInvocations`, custom system message providers, etc. |
| `KoogStrategy` | Koog | Swaps default `chatAgentStrategy()` with a custom `AIAgentGraphStrategy<String, String>` from the `strategy {}` DSL |
| `AdkRootAgent` | ADK | Replaces the runtime's default `LlmAgent` with `SequentialAgent` / `ParallelAgent` / `LoopAgent` / any `BaseAgent` subclass |
| `SemanticKernelInvocation` | Semantic Kernel | Per-request `InvocationContext` — unlocks `KernelHooks`, `withMaxAutoInvokeAttempts`, custom `PromptExecutionSettings` |
| `EmbabelPromptRunner` | Embabel | `UnaryOperator<PromptRunner>` customizer applied AFTER the runtime's default wiring — stack `withTemperature` / `withModel` / `withGuardrails` on top. Atmosphere-native dispatch path only |
| `AgentScopeAgent` | AgentScope | Per-request `ReActAgent` — useful when different prompts route through different agent topologies (planner vs. quick lookup) without re-installing the runtime client |
| `SpringAiAlibabaRunnableConfig` | Spring AI Alibaba | Per-request `RunnableConfig` — Alibaba's natural per-invocation handle for `threadId` (memory thread continuation), `checkPointId` (resume), `streamMode`, metadata, store |
| `ToolLoopPolicies` | Built-in, Koog | Per-request `ToolLoopPolicy(maxIterations, OnMaxIterations)` — Built-in honors via OpenAI-compatible tool loop, Koog via `AIAgent.maxIterations` |

Example — Spring AI advisor scoped to one request:

```java
var safeGuard = SafeGuardAdvisor.builder()
        .sensitiveWords(List.of("badword"))
        .failureResponse("I cannot answer that.")
        .build();

var ctx = SpringAiAdvisors.attach(baseContext, safeGuard, new SimpleLoggerAdvisor());
runtime.execute(ctx, session);
```

Each helper ships with a unit-level `*BridgeTest` that proves the runtime
honors the sidecar (e.g. `SpringAiAgentRuntime.execute` calls
`promptSpec.advisors(perRequestAdvisors)` only when `SpringAiAdvisors.from(context)`
returns non-empty). See the per-module READMEs for full DSL examples:
[`modules/spring-ai`](https://github.com/Atmosphere/atmosphere/blob/main/modules/spring-ai/README.md#per-request-advisors-springaiadvisors),
[`modules/langchain4j`](https://github.com/Atmosphere/atmosphere/blob/main/modules/langchain4j/README.md#per-request-aiservices-langchain4jaiservices),
[`modules/koog`](https://github.com/Atmosphere/atmosphere/blob/main/modules/koog/README.md#per-request-strategy-koogstrategy),
[`modules/adk`](https://github.com/Atmosphere/atmosphere/blob/main/modules/adk/README.md#multi-agent-composition-adkrootagent),
and the [`ToolLoopPolicy`](https://github.com/Atmosphere/atmosphere/blob/main/modules/ai/README.md#tool-loop-policy) section.

All eight framework runtimes now ship a per-request sidecar (the four added
most recently — `SemanticKernelInvocation`, `EmbabelPromptRunner`,
`AgentScopeAgent`, `SpringAiAlibabaRunnableConfig` — close the matrix that
previously left these adapters without a per-request escape hatch). `Embabel`
also has **native streaming**: when
`StreamingPromptRunnerBuilder.streaming().generateStream()` is available the
runtime emits `Flux<String>` chunks directly to the session, with graceful
fallback to `runner.generateText(...)` when the streaming API is absent.

### Model-Lifecycle Observability

`AgentLifecycleListener` exposes three model-lifecycle hooks in addition to the
tool hooks (`onToolCall`/`onToolResult`):

```java
default void onModelStart(String model, int messageCount, int toolCount) { }
default void onModelEnd(String model, TokenUsage usage, long durationMillis) { }
default void onModelError(String model, Throwable t) { }
```

Built-in `OpenAiCompatibleClient` fires these around every model dispatch
(including each tool-loop round). `AiEventForwardingListener` is a built-in
adapter that translates the hooks into `AiEvent.Progress` frames on the
streaming session — opt in by attaching it via `context.withListeners(...)`:

```java
var listeners = List.of(new AiEventForwardingListener(session));
runtime.execute(context.withListeners(listeners), session);
// Browser receives wire frames like:
//   {"type":"progress","message":"model:start (gpt-4o, msgs=3, tools=2)"}
//   {"type":"progress","message":"model:end (gpt-4o, in=120, out=85, ms=842)"}
```

## Conversation Memory

Enable multi-turn conversations with one annotation attribute:

```java
@AiEndpoint(path = "/ai/chat",
            systemPrompt = "You are a helpful assistant",
            conversationMemory = true,
            maxHistoryMessages = 20)
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);
    }
}
```

When `conversationMemory = true`, the framework:

1. Captures each user message and the streamed assistant response (via `MemoryCapturingSession`)
2. Stores them as conversation turns per `AtmosphereResource`
3. Injects the full history into every subsequent `AiRequest`
4. Clears the history when the resource disconnects

The default implementation is `InMemoryConversationMemory` (capped at `maxHistoryMessages`, default 20). For external storage, implement the `AiConversationMemory` SPI:

```java
public interface AiConversationMemory {
    List<ChatMessage> getHistory(String conversationId);
    void addMessage(String conversationId, ChatMessage message);
    void clear(String conversationId);
    int maxMessages();
}
```

## @AiTool -- Framework-Agnostic Tool Calling

Declare tools with `@AiTool` and they work with every tool-capable runtime:
Built-in, Spring AI, LangChain4j, Google ADK, Embabel, Koog, and Semantic
Kernel. No framework-specific annotations are needed. AgentScope and Spring
AI Alibaba are still `AgentRuntime` adapters, but their current SDKs do not
expose a native tool-dispatch loop for Atmosphere to wrap.

### Defining Tools

```java
public class AssistantTools {

    @AiTool(name = "get_weather",
            description = "Returns a weather report for a city")
    public String getWeather(
            @Param(value = "city", description = "City name to get weather for")
            String city) {
        return weatherService.lookup(city);
    }

    @AiTool(name = "convert_temperature",
            description = "Converts between Celsius and Fahrenheit")
    public String convertTemperature(
            @Param(value = "value", description = "Temperature value") double value,
            @Param(value = "from_unit", description = "'C' or 'F'") String fromUnit) {
        return "C".equalsIgnoreCase(fromUnit)
                ? String.format("%.1f°C = %.1f°F", value, value * 9.0 / 5.0 + 32)
                : String.format("%.1f°F = %.1f°C", value, (value - 32) * 5.0 / 9.0);
    }
}
```

### Wiring Tools to an Endpoint

```java
@AiEndpoint(path = "/ai/chat",
            systemPrompt = "You are a helpful assistant",
            conversationMemory = true,
            tools = AssistantTools.class)
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // tools are automatically available to the LLM
    }
}
```

### How It Works

```
@AiTool methods
    ↓ scan at startup
DefaultToolRegistry (global)
    ↓ selected per-endpoint via tools = {...}
AiRequest.withTools(tools)
    ↓ bridged to backend-native format
LangChain4jToolBridge / SpringAiToolBridge / AdkToolBridge
    ↓ LLM decides to call a tool
ToolExecutor.execute(args) → result fed back to LLM
    ↓
StreamingSession → WebSocket → browser
```

The tool bridge layer converts `@AiTool` to the native format at runtime:

| Backend | Bridge Class | Native Format |
|---------|-------------|---------------|
| LangChain4j | `LangChain4jToolBridge` | `ToolSpecification` |
| Spring AI | `SpringAiToolBridge` | `ToolCallback` |
| Google ADK | `AdkToolBridge` | `BaseTool` |

### @AiTool vs Native Annotations

| | `@AiTool` (Atmosphere) | `@Tool` (LangChain4j) | `FunctionCallback` (Spring AI) |
|--|------------------------|----------------------|-------------------------------|
| Portable | Any backend | LangChain4j only | Spring AI only |
| Parameter metadata | `@Param` annotation | `@P` annotation | JSON Schema |
| Registration | `ToolRegistry` (global) | Per-service | Per-ChatClient |

To swap the AI backend, change only the Maven dependency -- no tool code changes:

```xml
<!-- Use LangChain4j -->
<artifactId>atmosphere-langchain4j</artifactId>

<!-- Or Spring AI -->
<artifactId>atmosphere-spring-ai</artifactId>

<!-- Or Google ADK -->
<artifactId>atmosphere-adk</artifactId>
```

See the [spring-boot-ai-tools](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-tools) sample.

## AiInterceptor

Cross-cutting concerns (RAG, guardrails, logging) go through `AiInterceptor`, not subclassing:

```java
@AiEndpoint(path = "/ai/chat", interceptors = {RagInterceptor.class, LoggingInterceptor.class})
public class MyChat { ... }

public class RagInterceptor implements AiInterceptor {
    @Override
    public AiRequest preProcess(AiRequest request, AtmosphereResource resource) {
        String context = vectorStore.search(request.message());
        return request.withMessage(context + "\n\n" + request.message());
    }
}
```

## Filters, Routing, and Middleware

The AI module includes filters and middleware that sit between the `@Prompt` method and the LLM:

| Class | What it does |
|-------|-------------|
| `PiiRedactionFilter` | Buffers messages to sentence boundaries, redacts email/phone/SSN/CC |
| `ContentSafetyFilter` | Pluggable `SafetyChecker` SPI -- block, redact, or pass |
| `CostMeteringFilter` | Per-session/broadcaster message counting with budget enforcement |
| `RoutingLlmClient` | Route by content, model, cost, or latency rules |
| `FanOutStreamingSession` | Concurrent N-model streaming: AllResponses, FirstComplete, FastestStreamingTexts |
| `StreamingTextBudgetManager` | Per-user/org budgets with graceful degradation |
| `AiResponseCacheInspector` | Cache control for AI messages in `BroadcasterCache` |
| `AiResponseCacheListener` | Aggregate per-session events instead of per-message noise |

### Cost and Latency Routing

`RoutingLlmClient` supports cost-based and latency-based routing rules:

```java
var router = RoutingLlmClient.builder(defaultClient, "gemini-2.5-flash")
        .route(RoutingRule.costBased(5.0, List.of(
                new ModelOption(openaiClient, "gpt-4o", 0.01, 200, 10),
                new ModelOption(geminiClient, "gemini-flash", 0.001, 50, 5))))
        .route(RoutingRule.latencyBased(100, List.of(
                new ModelOption(ollamaClient, "llama3.2", 0.0, 30, 3),
                new ModelOption(openaiClient, "gpt-4o-mini", 0.005, 80, 7))))
        .build();
```

## Direct Adapter Usage

You can bypass `@AiEndpoint` and use adapters directly:

**Spring AI:**
```java
var session = StreamingSessions.start(resource);
springAiAdapter.stream(chatClient, prompt, session);
```

**LangChain4j:**
```java
var session = StreamingSessions.start(resource);
model.chat(ChatMessage.userMessage(prompt),
    new AtmosphereStreamingResponseHandler(session));
```

**Google ADK:**
```java
var session = StreamingSessions.start(resource);
adkAdapter.stream(new AdkRequest(runner, userId, sessionId, prompt), session);
```

**Embabel:**
```kotlin
val session = StreamingSessions.start(resource)
embabelAdapter.stream(AgentRequest("assistant") { channel ->
    agentPlatform.run(prompt, channel)
}, session)
```

## Browser -- React

```tsx
import { useStreaming } from 'atmosphere.js/react';

function AiChat() {
  const { fullText, isStreaming, stats, routing, send } = useStreaming({
    request: { url: '/ai/chat', transport: 'websocket' },
  });

  return (
    <div>
      <button onClick={() => send('Explain WebSockets')} disabled={isStreaming}>
        Ask
      </button>
      <p>{fullText}</p>
      {stats && <small>{stats.totalStreamingTexts} streaming texts</small>}
      {routing.model && <small>Model: {routing.model}</small>}
    </div>
  );
}
```

## AI in Rooms -- Virtual Members

```java
var client = AiConfig.get().client();
var assistant = new LlmRoomMember("assistant", client, "gpt-5",
    "You are a helpful coding assistant");

Room room = rooms.room("dev-chat");
room.joinVirtual(assistant);
// Now when any user sends a message, the LLM responds in the same room
```

## StreamingSession Wire Protocol

The client receives JSON messages over WebSocket/SSE:

- `{"type":"streaming-text","content":"Hello"}` -- a single streaming text
- `{"type":"progress","message":"Thinking..."}` -- status update
- `{"type":"complete"}` -- stream finished
- `{"type":"error","message":"..."}` -- stream failed

## Configuration

Configure the built-in client with environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_MODE` | `remote` (cloud) or `local` (Ollama) | `remote` |
| `LLM_MODEL` | `gemini-2.5-flash`, `gpt-5`, `o3-mini`, `llama3.2`, ... | `gemini-2.5-flash` |
| `LLM_API_KEY` | API key (or `GEMINI_API_KEY` for Gemini) | -- |
| `LLM_BASE_URL` | Override endpoint (auto-detected from model name) | auto |

## Key Components

| Class | Description |
|-------|-------------|
| `@AiEndpoint` | Marks a class as an AI chat endpoint with a path, system prompt, and interceptors |
| `@Prompt` | Marks the method that handles user messages |
| `@AiTool` | Marks a method as an AI-callable tool (framework-agnostic) |
| `@Param` | Describes a tool parameter's name, description, and required flag |
| `AgentRuntime` | SPI for AI framework backends (ServiceLoader-discovered) |
| `AiRequest` | Framework-agnostic request record (message, systemPrompt, model, userId, sessionId, agentId, conversationId, metadata) |
| `AiEvent` | Sealed interface: 13 structured event types (TextDelta, ToolStart, ToolResult, AgentStep, EntityStart, etc.) |
| `AiCapability` | Enum for endpoint capability requirements (TEXT_STREAMING, TOOL_CALLING, STRUCTURED_OUTPUT, etc.) |
| `AiInterceptor` | Pre/post processing hooks for RAG, guardrails, logging |
| `AiConversationMemory` | SPI for conversation history storage |
| `MemoryStrategy` | Pluggable memory selection: MessageWindowStrategy, TokenWindowStrategy, SummarizingStrategy |
| `StructuredOutputParser` | SPI for JSON Schema generation and typed output parsing (built-in: JacksonStructuredOutputParser) |
| `StreamingSession` | Delivers streaming texts, events, progress updates, and metadata to the client |
| `StreamingSessions` | Factory for creating `StreamingSession` instances |
| `OpenAiCompatibleClient` | Built-in HTTP client for OpenAI-compatible APIs |
| `RoutingLlmClient` | Routes prompts to different LLM backends based on rules |
| `ToolRegistry` | Global registry for `@AiTool` definitions |
| `ModelRouter` | SPI for intelligent model routing and failover |
| `AiGuardrail` | SPI for pre/post-LLM safety inspection |
| `AiMetrics` | SPI for AI observability (streaming texts, latency, cost) |
| `ConversationPersistence` | SPI for durable conversation storage (Redis, SQLite) |
| `RetryPolicy` | Exponential backoff with circuit-breaker semantics |

## Approval Gates

`@RequiresApproval` pauses tool execution until the client approves. The virtual thread parks cheaply on a `CompletableFuture` -- no carrier thread consumed.

```java
@AiTool(name = "delete_account", description = "Permanently delete a user account")
@RequiresApproval("This will permanently delete the account. Are you sure?")
public String deleteAccount(@Param("accountId") String accountId) {
    return accountService.delete(accountId);
}
```

### Wire Protocol

When the LLM calls a `@RequiresApproval` tool, the client receives an `approval-required` event:

```json
{"event":"approval-required","data":{
  "approvalId":"apr_a1b2c3d4e5f6",
  "toolName":"delete_account",
  "arguments":{"accountId":"user-42"},
  "message":"This will permanently delete the account. Are you sure?",
  "expiresIn":300
}}
```

The client responds with:
- `/__approval/apr_a1b2c3d4e5f6/approve` -- tool executes
- `/__approval/apr_a1b2c3d4e5f6/deny` -- tool returns cancelled

Default timeout: 5 minutes. Configurable via `@RequiresApproval(timeoutSeconds = 120)`.

### How It Works

1. `AiStreamingSession.wrapApprovalGates()` wraps `@RequiresApproval` tools with `ApprovalGateExecutor`
2. When the LLM calls the tool, `ApprovalGateExecutor` parks the virtual thread on `CompletableFuture.get(timeout)`
3. The session emits `AiEvent.ApprovalRequired` to the client
4. `AiEndpointHandler` fast-paths `/__approval/` messages to the session's `ApprovalRegistry` (before prompt dispatch)
5. `ApprovalRegistry.tryResolve()` completes the future, unparking the virtual thread
6. On transport reconnect, a fallback scan across all active sessions ensures the approval reaches the parked thread

### ADK ToolConfirmation Bridge

When running on Google ADK, Atmosphere also calls `toolContext.requestConfirmation()` to give ADK native visibility into the approval pause. If ADK resolves a confirmation before Atmosphere (e.g., via its own UI), the ADK denial short-circuits without calling the executor. This creates a two-layer model: Atmosphere-level (cross-runtime) + ADK-native (runtime-specific).

All runtimes with `TOOL_CALLING` also declare `AiCapability.TOOL_APPROVAL` (Built-in, Spring AI, LangChain4j, ADK, Embabel, Koog, Semantic Kernel). AgentScope and Spring AI Alibaba are excluded because their underlying SDKs lack a native tool-call dispatch loop.

## Context Compaction SPI

The `AiCompactionStrategy` SPI controls how conversation history is compacted when it exceeds the configured limit. Unlike `MemoryStrategy` (which selects messages for the next request -- read path), compaction permanently reduces stored history (write path).

```java
public interface AiCompactionStrategy {
    List<ChatMessage> compact(List<ChatMessage> messages, int maxMessages);
    String name();
}
```

### Built-in Strategies

**`SlidingWindowCompaction`** (default) -- drops the oldest non-system messages until under the limit. System messages are always preserved.

**`SummarizingCompaction`** -- condenses old messages into a single system-role summary, preserving the most recent messages verbatim. The recent window size is configurable (default: 6).

```java
// Default: sliding window
var memory = new InMemoryConversationMemory(20);

// Custom: summarization with 8-message recent window
var memory = new InMemoryConversationMemory(20, new SummarizingCompaction(8));
```

### ADK Bridge

`AdkCompactionBridge.toAdkConfig()` maps Atmosphere compaction settings to ADK's `EventsCompactionConfig` for native compaction when using the ADK runtime.

## Artifact Persistence SPI

The `ArtifactStore` SPI provides binary artifact persistence across agent runs. Use cases include agent-generated reports, images, code files, and content shared between coordinated agents.

```java
public interface ArtifactStore {
    Artifact save(Artifact artifact);                              // auto-versions
    Optional<Artifact> load(String namespace, String artifactId);  // latest version
    Optional<Artifact> load(String namespace, String artifactId, int version);
    List<Artifact> list(String namespace);                         // latest of each
    boolean delete(String namespace, String artifactId);           // all versions
    void deleteAll(String namespace);
}
```

### Artifact Record

```java
public record Artifact(
    String id,                    // unique identifier
    String namespace,             // grouping key (session ID, agent name, user ID)
    String fileName,              // human-readable name ("report.pdf")
    String mimeType,              // MIME type ("application/pdf")
    byte[] data,                  // binary content (defensively copied)
    int version,                  // auto-incremented per save
    Map<String, String> metadata, // arbitrary key-value pairs
    Instant createdAt
) { }
```

Byte arrays are defensively copied on construction and on access -- callers cannot mutate persisted data.

### Implementations

- **`InMemoryArtifactStore`** -- default, for development and testing. Data does not survive JVM restart.
- **ADK bridge** -- `AdkArtifactBridge.toAdkService()` wraps an `ArtifactStore` as ADK's `BaseArtifactService`.

## Interceptor Disconnect Lifecycle

`AiInterceptor` includes an `onDisconnect` hook called **before** conversation memory is cleared. This enables fact extraction, summary persistence, and other cleanup that requires access to the conversation history.

```java
public interface AiInterceptor {
    default AiRequest preProcess(AiRequest request, AtmosphereResource resource) { return request; }
    default void postProcess(AiRequest request, AtmosphereResource resource) { }
    default void onDisconnect(String userId, String conversationId, List<ChatMessage> history) { }
}
```

`LongTermMemoryInterceptor.onDisconnect()` uses this to extract facts from the full conversation on session close via `OnSessionCloseStrategy`.

Execution order: `preProcess` runs FIFO, `postProcess` runs LIFO, `onDisconnect` runs FIFO. Exceptions in one interceptor do not prevent others from being called.

## AiEvent Model

The `AiEvent` sealed interface provides 15 structured event types emitted via `session.emit()`. All runtimes map their native events to this common model.

| Event | Description |
|-------|-------------|
| `TextDelta` | Streaming token |
| `TextComplete` | Final assembled text |
| `ToolStart` | Tool invocation begins (name + arguments) |
| `ToolResult` | Tool executed successfully (name + result) |
| `ToolError` | Tool execution failed |
| `AgentStep` | Orchestration step (ADK agent steps, Embabel planning) |
| `StructuredField` | Structured output field arrival |
| `EntityStart` / `EntityComplete` | Structured entity streaming |
| `RoutingDecision` | Backend routing event |
| `Progress` | Long-running operation status |
| `Handoff` | Agent handoff notification |
| `ApprovalRequired` | Human approval gate |
| `Error` | Error with recovery hint |
| `Complete` | Stream completed with usage metadata |

### Runtime Event Normalization

| Source | Atmosphere Event |
|--------|-----------------|
| ADK `event.functionCalls()` | `AiEvent.ToolStart` |
| ADK `event.functionResponses()` | `AiEvent.ToolResult` |
| ADK `event.author()` (non-partial) | `AiEvent.AgentStep` |
| ADK `event.usageMetadata()` | `ai.tokens.input/output/total` metadata |
| Koog `onToolCallStarting` | `AiEvent.ToolStart` |
| Koog `onToolCallCompleted` | `AiEvent.ToolResult` |
| Koog `onToolCallFailed` | `AiEvent.ToolError` |
| Koog `StreamFrame.ReasoningDelta` | `AiEvent.Progress` |
| Embabel `MessageOutputChannelEvent` | `AiEvent.TextDelta` |
| Embabel `ProgressOutputChannelEvent` | `AiEvent.AgentStep` |

## Capability Matrix

Each runtime declares capabilities via `AiCapability`. The framework uses
these flags for model routing, tool negotiation, and feature discovery. The
table below mirrors the nine-runtime snapshot pinned by each runtime's
`expectedCapabilities()` contract test; `Y` means the runtime declares the
capability and the contract tests assert it.

Legend: TS=TEXT_STREAMING, TC=TOOL_CALLING, SO=STRUCTURED_OUTPUT,
SP=SYSTEM_PROMPT, AO=AGENT_ORCHESTRATION, CM=CONVERSATION_MEMORY,
TA=TOOL_APPROVAL, V=VISION, A=AUDIO, MM=MULTI_MODAL, PC=PROMPT_CACHING,
TU=TOKEN_USAGE, PRR=PER_REQUEST_RETRY, TCD=TOOL_CALL_DELTA,
BE=BUDGET_ENFORCEMENT, CS=CONFIDENCE_SCORES, PSV=PASSIVATION.

| Runtime | Priority | TS | TC | SO | SP | AO | CM | TA | V | A | MM | PC | TU | PRR | TCD | BE | CS | PSV |
|---------|---------:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:-:|:-:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Built-in | 0 | Y | Y | Y | Y |  | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Spring AI | 100 | Y | Y | Y | Y |  | Y | Y | Y | Y | Y | Y | Y | Y |  | Y | Y | Y |
| LangChain4j | 100 | Y | Y | Y | Y |  | Y | Y | Y | Y | Y | Y | Y | Y |  | Y | Y | Y |
| Google ADK | 100 | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |  | Y | Y | Y |
| Embabel | 100 | Y | Y | Y | Y | Y | Y | Y | Y |  | Y |  | Y | Y |  | Y | Y | Y |
| JetBrains Koog | 100 | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |  | Y | Y | Y |
| Alibaba AgentScope | 100 | Y | Y | Y | Y |  | Y | Y |  |  |  |  | Y | Y |  | Y | Y | Y |
| Spring AI Alibaba | 100 | Y¹ | Y | Y | Y |  | Y | Y |  |  |  |  | Y | Y |  | Y | Y | Y |
| Microsoft Semantic Kernel | 100 | Y | Y | Y | Y |  | Y | Y |  |  |  |  | Y | Y |  | Y | Y | Y |

¹ Spring AI Alibaba emits its final reply as one Atmosphere stream chunk, but
the upstream `ReactAgent.call()` path is buffered rather than token-by-token.

**How structured output works:** `AiPipeline` wraps the streaming session with `StructuredOutputCapturingSession` and augments the system prompt with JSON-schema instructions before the runtime runs. Any runtime that honors `SYSTEM_PROMPT` therefore gets `STRUCTURED_OUTPUT` automatically via the pipeline — no per-runtime adapter code required. `BuiltInAgentRuntime` additionally enables native `jsonMode` on the OpenAI-compatible client for provider-level JSON enforcement on top of the pipeline wrap. Source: `modules/ai/src/main/java/org/atmosphere/ai/pipeline/AiPipeline.java:128-135`, `modules/ai/src/main/java/org/atmosphere/ai/llm/BuiltInAgentRuntime.java:72-74`.

**Tool-dispatch bridges:** every runtime that declares `TOOL_CALLING` routes
every Atmosphere `@AiTool` invocation through a runtime-native bridge that
calls `ToolExecutionHelper.executeWithApproval`, so `@RequiresApproval` gates
fire uniformly. AgentScope ships `AgentScopeToolBridge`, Spring AI Alibaba
ships `SpringAiAlibabaToolBridge`, Semantic Kernel ships
`SemanticKernelToolBridge`, Embabel ships `EmbabelToolBridge`, Koog ships
`AtmosphereToolBridge`, and the JDK runtimes (Built-in, Spring AI,
LangChain4j, ADK) wire their tool callbacks through the shared helper
directly.

**Spring AI Alibaba token usage:** `ReactAgent.call()` returns an
`AssistantMessage` without usage metadata, so Atmosphere wraps the configured
Spring AI `ChatModel` bean in a `UsageCapturingChatModel` decorator at
auto-configuration time. Every underlying `ChatModel.call(Prompt)` performed
by the ReAct graph during a single dispatch accumulates
`ChatResponseMetadata.getUsage()` into a per-thread collector; the runtime
emits one typed `TokenUsage` record via `session.usage(...)` after the agent
returns. Token-based `AiBudget` breaches therefore trip uniformly alongside
wall-clock breaches. Custom `ReactAgent` beans that bypass the auto-config
also bypass the wrapper — see `AtmosphereSpringAiAlibabaAutoConfiguration`
for the wrapping point.

## Cross-Runtime Contract Tests (TCK)

The `AbstractAgentRuntimeContractTest` base class in `atmosphere-ai-test` enforces a minimum contract across all runtime adapters.

```java
public abstract class AbstractAgentRuntimeContractTest {
    protected abstract AgentRuntime createRuntime();
    protected abstract AgentExecutionContext createTextContext();
    protected abstract AgentExecutionContext createToolCallContext();
    protected abstract AgentExecutionContext createErrorContext();

    // Enforced contracts:
    // - runtimeDeclaresMinimumCapabilities (TEXT_STREAMING)
    // - runtimeHasNonBlankName
    // - runtimeIsAvailable
    // - textStreamingCompletesSession (10s timeout)
    // - toolCallExecutesIfSupported
    // - errorContextTriggersSessionError
}
```

Add `atmosphere-ai-test` as a test dependency and extend the base class:

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-ai-test</artifactId>
    <scope>test</scope>
</dependency>
```

The `RecordingSession` test double captures all events, text chunks, metadata, and errors for assertion. The contract suite is implemented for all nine runtime adapters.

## Samples

- [Spring Boot AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) -- built-in client with Gemini/OpenAI/Ollama
- [Spring Boot AI Tools](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-tools) -- framework-agnostic `@AiTool` pipeline
- [Spring Boot AI Classroom](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-classroom) -- rooms-based multi-room AI with an Expo client
- [Spring Boot RAG Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-rag-chat) -- Spring AI VectorStore-backed RAG agent
- [Quarkus AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/quarkus-ai-chat) -- five `@AiEndpoint` demos on Quarkus + LangChain4j bridge
- [Spring Boot Dentist Agent](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-dentist-agent) -- `@Agent` with tools, memory, and approval gates

## See Also

- [Spring AI Adapter](../../integrations/spring-ai/)
- [LangChain4j Adapter](../../integrations/langchain4j/)
- [Google ADK Adapter](../../integrations/adk/)
- [Embabel Adapter](../../integrations/embabel/)
- [MCP Server](mcp/) -- AI-MCP bridge for tool-driven streaming
- [Rooms & Presence](rooms/) -- AI virtual members in rooms
- [atmosphere.js](../../clients/javascript/) -- `useStreaming` React/Vue/Svelte hooks
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/ai)
