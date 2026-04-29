---
title: "AI Framework Adapters"
description: "Plugging Spring AI, LangChain4j, Google ADK, and Embabel into Atmosphere's streaming infrastructure"
sidebar:
  order: 11
---

Atmosphere's AI layer follows the same adapter pattern as its transport layer. Just as Atmosphere auto-detects WebSocket, SSE, or long-polling support at runtime, it auto-detects which AI framework is on the classpath and bridges it to the `StreamingSession` API via the `AgentRuntime` SPI.

## Dependencies

Add the Atmosphere Spring Boot starter and the adapter module for the framework you want. Adapter modules transitively pull in `atmosphere-ai` (the framework-agnostic SPI) and declare the underlying AI framework as `<scope>provided</scope>` — you supply the framework itself on your application classpath:

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-spring-boot-starter</artifactId>
    <version>${project.version}</version>
</dependency>

<!-- Pick one adapter (or add multiple and let priority() pick a winner): -->
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-spring-ai</artifactId>
    <version>${project.version}</version>
</dependency>
<!-- or atmosphere-langchain4j, atmosphere-adk,
     atmosphere-embabel, atmosphere-koog, atmosphere-semantic-kernel -->
```

Zero-extra-dep option: drop the adapter line and let the built-in OpenAI-compatible client in `atmosphere-ai` serve the requests. See the next section for when that's the right choice. Native framework versions Atmosphere is tested against are pinned in the [Runtimes table](#runtimes) two sections below.

## Built-in LLM Client (zero extra dependencies)

Before reaching for an adapter module, know that `atmosphere-ai` itself includes a built-in `OpenAiCompatibleClient`. This client works with **OpenAI**, **Google Gemini**, **Ollama**, **Azure OpenAI**, and any OpenAI-compatible endpoint — with zero additional dependencies beyond `atmosphere-ai`. The Maven coordinates for every module in this chapter are listed in the [Runtimes table](#runtimes) below and in the [Spring Boot integration guide](/docs/tutorial/14-spring-boot/).

Use it directly via `AiConfig`:

```java
var settings = AiConfig.get();
var request = ChatCompletionRequest.builder(settings.model())
        .system("You are a helpful assistant.")
        .user(prompt)
        .build();

settings.client().streamChatCompletion(request, session);
```

The built-in client is what powers `session.stream(message)` inside `@AiEndpoint`. If you need framework-specific features (Spring AI advisors, LangChain4j tool loops, ADK agent orchestration, Embabel agent planning), use one of the adapter modules below.

## Runtimes

Atmosphere ships **seven** `AgentRuntime` implementations — one built-in and six adapter modules for popular frameworks:

| Runtime | Module / Artifact | AI Framework | Version |
|---------|------------------|-------------|---------|
| Built-in | `atmosphere-ai` (OpenAI-compatible client) | OpenAI, Gemini, Ollama, Azure OpenAI | shipped |
| Spring AI | `atmosphere-spring-ai` | Spring AI (`ChatClient`) | 2.0.0-M2 |
| LangChain4j | `atmosphere-langchain4j` | LangChain4j (`StreamingChatLanguageModel`) | 1.12.2 |
| Google ADK | `atmosphere-adk` | Google Agent Development Kit (`Runner`) | 1.0.0 |
| Embabel | `atmosphere-embabel` | Embabel Agent Framework (`AgentPlatform`) | 0.3.4 |
| Koog | `atmosphere-koog` | Koog (Kotlin agent framework) | 0.7.3 |
| Semantic Kernel | `atmosphere-semantic-kernel` | Microsoft Semantic Kernel (`ChatCompletionService`) | 1.4.0 |

All runtimes depend on `atmosphere-ai`, which provides the framework-agnostic interfaces: `AgentRuntime`, `AiStreamingAdapter<T>`, `StreamingSession`, `AiRequest`, and the `@AiTool`/`@AiEndpoint` annotations.

## Per-runtime capability matrix

This table mirrors the exact `Set<AiCapability>` each runtime's `capabilities()` method returns — runtime truth, not wishful thinking (Correctness Invariant #5). Each row is pinned in the runtime's contract test via `expectedCapabilities()` in `AbstractAgentRuntimeContractTest`, so adding or removing a capability from the code without updating this table (or vice versa) breaks the build.

| Capability | Built-in | Spring AI | LC4j | ADK | Embabel | Koog | SK |
|------------|:--------:|:---------:|:----:|:---:|:-------:|:----:|:--:|
| `TEXT_STREAMING`      | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `SYSTEM_PROMPT`       | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `STRUCTURED_OUTPUT`   | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `TOOL_CALLING`        | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `TOOL_APPROVAL`       | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `CONVERSATION_MEMORY` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PER_REQUEST_RETRY`   | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `TOKEN_USAGE`         | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `VISION`              | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  — |
| `MULTI_MODAL`         | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  — |
| `AUDIO`               | ✅ | ✅ | ✅ | ✅ |  — | ✅ |  — |
| `PROMPT_CACHING`      | ✅ | ✅ | ✅ | ✅ |  — | ✅ |  — |
| `AGENT_ORCHESTRATION` |  — |  — |  — | ✅ | ✅ | ✅ |  — |
| `TOOL_CALL_DELTA`     | ✅ |  — |  — |  — |  — |  — |  — |

**Legend:**
- ✅ Declared in `capabilities()` and honored at runtime
- — Not declared. Either the framework's native API does not expose the feature, or the bridge has not threaded it through yet.

### Why the baseline is so high

The first eight rows are universal because `AbstractAgentRuntime` and the pipeline layer implement them once and every runtime that extends or delegates to them inherits the behavior. The framework builds the default, the adapter only plugs in where it differs.

- **`STRUCTURED_OUTPUT`** is implemented at the pipeline layer — `AiPipeline.StructuredOutputCapturingSession` plus system-prompt schema injection — so any runtime that honors `SYSTEM_PROMPT` gets it for free (`BuiltInAgentRuntime` additionally enables native JSON mode).
- **`CONVERSATION_MEMORY`** is implemented by `AbstractAgentRuntime.assembleMessages`, which threads `context.history()` into the outgoing message list on every dispatch. Runtimes with a native conversation-id path (ADK `Runner`, Koog `AIAgent`, SK `ChatHistory`) use that; the rest honor the pipeline-managed history via the base class.
- **`PER_REQUEST_RETRY`** is implemented by `AbstractAgentRuntime.executeWithOuterRetry`, which wraps each runtime's dispatch in a retry loop respecting `context.retryPolicy(...)`. Each adapter stacks this on top of its own native retry layer (Spring Retry, LC4j `RetryUtils`, ADK `HttpClient`, Koog `CallRetryPolicy`, SK `OpenAIAsyncClient`), giving an "at least N retries" guarantee that is uniform across every runtime.
- **`TOOL_CALLING` / `TOOL_APPROVAL`** are implemented per-adapter (`SpringAiToolBridge`, `LangChain4jToolBridge`, `AdkFunctionToolBridge`, `EmbabelToolBridge`, `AtmosphereToolBridge` for Koog, `SemanticKernelToolBridge`) — each routes every invocation through `ToolExecutionHelper.executeWithApproval` so `@RequiresApproval` gates fire uniformly regardless of which runtime handles the call.
- **`TOKEN_USAGE`** is honest wherever each bridge threads a typed `TokenUsage` record through `session.usage(...)` — done per-runtime but declared universally, because the pipeline surfaces the record on every adapter today.

### Notes on the remaining gaps

- **`VISION` / `AUDIO` / `MULTI_MODAL`** — Semantic Kernel has no multi-modal surface yet. Embabel's Atmosphere-native dispatch path translates `Content.Image` into Embabel `AgentImage` (no audio); the deployed-agent path ignores multi-modal parts, matching Embabel's own semantics where a deployed `@Agent` owns its own handling. Koog 0.7.3 accepts vision, audio, and multi-modal natively via `ContentPart.Image` / `ContentPart.Audio`, but its tool-calling surface (`AIAgent.run(String)`) only accepts a plain text message — multi-modal + tools together degrade gracefully (the tool path wins with a WARN).
- **`PROMPT_CACHING`** — Built-in / Spring AI / LC4j / ADK / Koog all honor the portable `CacheHint` attached to `AgentExecutionContext`. Mechanism varies per provider (OpenAI `prompt_cache_key`, Anthropic / Bedrock `CacheControl.Bedrock.{FiveMinutes, OneHour}`, ADK's per-request `ContextCacheConfig` wired via `buildRequestRunner`). Embabel and Semantic Kernel do not expose a caching hook that maps to `CacheHint` today.
- **`AGENT_ORCHESTRATION`** tracks whether the underlying framework owns a multi-agent dispatch loop (ADK `LlmAgent`, Embabel goal graph, Koog `chatAgentStrategy`). Built-in / Spring AI / LC4j / SK can still participate in `@Coordinator` fleets — the coordinator dispatches from Atmosphere — but do not own the loop themselves.
- **`TOOL_CALL_DELTA`** is Built-in only. `OpenAiCompatibleClient` forwards every `delta.tool_calls[].function.arguments` fragment through `session.toolCallDelta(id, chunk)` on both the chat-completions and responses-API streaming paths. The six framework bridges cannot emit deltas without bypassing their high-level streaming APIs; they honor the default no-op contract instead.

When a framework adds a capability in a new release, update both the runtime's `capabilities()` method and the `expectedCapabilities()` override in its contract test in the same commit. The contract test will fail on either side of a drift, which is the intended safety net.

## The adapter architecture

Two SPIs form the backbone:

**`AiStreamingAdapter<T>`** is the low-level bridge. Each adapter converts one framework-specific request type into `StreamingSession` calls:

```java
public interface AiStreamingAdapter<T> {
    String name();
    void stream(T request, StreamingSession session);
}
```

**`AgentRuntime`** is the high-level SPI detected by `ServiceLoader`. It dispatches the entire agent loop — tool calling, memory, RAG, retries — to the AI framework on the classpath:

```java
public interface AgentRuntime {
    String name();                     // e.g. "langchain4j", "spring-ai", "google-adk"
    boolean isAvailable();
    int priority();
    void configure(AiConfig.LlmSettings settings);
    Set<AiCapability> capabilities();
    void execute(AgentExecutionContext context, StreamingSession session);
}
```

When multiple `AgentRuntime` implementations are on the classpath, the one with the highest `priority()` that reports `isAvailable() == true` wins. All five shipped adapters use priority `100`. The built-in runtime uses priority `0` as a fallback.

## Spring AI adapter

**Module:** `atmosphere-spring-ai`
**Package:** `org.atmosphere.ai.spring`

### Classes

| Class | Role |
|-------|------|
| `SpringAiStreamingAdapter` | Bridges `ChatClient` Flux-based streaming to `StreamingSession`. Supports advisors (RAG, logging, memory) via a customizer callback. |
| `SpringAiAgentRuntime` | `AgentRuntime` implementation backed by `ChatClient`. Capabilities: `TEXT_STREAMING`, `TOOL_CALLING`, `STRUCTURED_OUTPUT`, `SYSTEM_PROMPT`. |
| `SpringAiToolBridge` | Converts Atmosphere `ToolDefinition` to Spring AI `ToolCallback`. Spring AI handles the tool call loop automatically. |
| `AtmosphereSpringAiAutoConfiguration` | Spring Boot `@AutoConfiguration`. Activates when `ChatClient` is on the classpath. |

### Auto-configuration

The auto-configuration creates a `SpringAiStreamingAdapter` bean and, if a `ChatClient` bean exists, wires it into `SpringAiAgentRuntime`:

```java
@AutoConfiguration
@ConditionalOnClass(name = "org.springframework.ai.chat.client.ChatClient")
public class AtmosphereSpringAiAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public SpringAiStreamingAdapter springAiStreamingAdapter() {
        return new SpringAiStreamingAdapter();
    }

    @Bean
    @ConditionalOnBean(ChatClient.class)
    SpringAiAgentRuntime springAiSupportBridge(ChatClient chatClient) {
        SpringAiAgentRuntime.setChatClient(chatClient);
        return new SpringAiAgentRuntime();
    }
}
```

### Direct adapter usage

For fine-grained control, use `SpringAiStreamingAdapter` directly:

```java
var session = StreamingSessions.start(resource);
adapter.stream(chatClient, "Tell me about Atmosphere", session);
```

With advisors:

```java
adapter.stream(chatClient, "Tell me about Atmosphere", session,
    spec -> spec.advisors(myRagAdvisor, myLoggingAdvisor)
                .system("You are a helpful assistant"));
```

### How SpringAiAgentRuntime works

When an `@AiEndpoint` receives a message, `SpringAiAgentRuntime.execute()` runs the following sequence:

1. Build a prompt spec from the `AiRequest` (system prompt, conversation history, user message).
2. If the request includes `@AiTool` definitions, convert them to Spring AI `ToolCallback` instances via `SpringAiToolBridge.toToolCallbacks()` and attach them with `promptSpec.toolCallbacks(callbacks)`.
3. Subscribe to the `Flux<ChatResponse>` from `promptSpec.stream().chatResponse()`.
4. For each response chunk, extract the text via `response.getResult().getOutput().getText()` and forward it to `session.send()`.
5. On Flux completion, call `session.complete()`. On error, call `session.error()`.

## LangChain4j adapter

**Module:** `atmosphere-langchain4j`
**Package:** `org.atmosphere.ai.langchain4j`

### Classes

| Class | Role |
|-------|------|
| `LangChain4jStreamingAdapter` | Bridges `StreamingChatLanguageModel` to `StreamingSession`. |
| `AtmosphereStreamingResponseHandler` | Simple `StreamingChatResponseHandler`: forwards streaming texts via `session.send()`, completion via `session.complete()`. |
| `ToolAwareStreamingResponseHandler` | Extends the basic handler with tool calling support. Executes tools via `LangChain4jToolBridge` and re-submits conversations. Max 5 tool rounds. |
| `LangChain4jAgentRuntime` | `AgentRuntime` implementation. Capabilities: `TEXT_STREAMING`, `TOOL_CALLING`, `STRUCTURED_OUTPUT`, `SYSTEM_PROMPT`. |
| `LangChain4jToolBridge` | Converts `ToolDefinition` to `ToolSpecification` and handles tool execution. |
| `AtmosphereLangChain4jAutoConfiguration` | Activates when `StreamingChatLanguageModel` is on the classpath. |

### Configuration example

A typical LangChain4j wiring (the same pattern used internally by `atmosphere-ai` when the LangChain4j adapter is on the classpath):

```java
@Configuration
public class LlmConfig {
    @Bean
    public AiConfig.LlmSettings llmSettings(
            @Value("${llm.mode:remote}") String mode,
            @Value("${llm.base-url:}") String baseUrl,
            @Value("${llm.api-key:}") String apiKey,
            @Value("${llm.model:gemini-2.5-flash}") String model) {
        return AiConfig.configure(mode, model, apiKey, baseUrl.isBlank() ? null : baseUrl);
    }

    @Bean
    public StreamingChatLanguageModel streamingChatModel(AiConfig.LlmSettings settings) {
        return OpenAiStreamingChatModel.builder()
                .baseUrl(settings.baseUrl())
                .apiKey(settings.client().apiKey())
                .modelName(settings.model())
                .build();
    }
}
```

The auto-configuration picks up the `StreamingChatLanguageModel` bean:

```java
@AutoConfiguration
@ConditionalOnClass(name = "dev.langchain4j.model.chat.StreamingChatLanguageModel")
public class AtmosphereLangChain4jAutoConfiguration {

    @Bean
    @ConditionalOnBean(StreamingChatLanguageModel.class)
    LangChain4jAgentRuntime langChain4jAiSupportBridge(StreamingChatLanguageModel model) {
        LangChain4jAgentRuntime.setModel(model);
        return new LangChain4jAgentRuntime();
    }
}
```

### Tool calling with LangChain4j

Unlike Spring AI, LangChain4j does not execute tool callbacks automatically. When the model responds with `ToolExecutionRequest` objects instead of text, `ToolAwareStreamingResponseHandler` handles the loop:

1. Receive the `AiMessage` with tool execution requests in `onCompleteResponse()`.
2. Call `LangChain4jToolBridge.executeToolCalls()` to run each tool and collect `ToolExecutionResultMessage` objects.
3. Append the AI message and tool results to the conversation history.
4. Re-submit the updated conversation to the model with a new `ToolAwareStreamingResponseHandler`.
5. Repeat until the model produces a text response or `MAX_TOOL_ROUNDS` (5) is reached.

## Google ADK adapter

**Module:** `atmosphere-adk`
**Package:** `org.atmosphere.ai.adk`

### Classes

| Class | Role |
|-------|------|
| `AdkStreamingAdapter` | Bridges ADK `Runner.runAsync()` RxJava `Flowable<Event>` to `StreamingSession` via `AdkEventAdapter`. |
| `AdkAgentRuntime` | `AgentRuntime` implementation. Capabilities: `TEXT_STREAMING`, `TOOL_CALLING`, `AGENT_ORCHESTRATION`, `CONVERSATION_MEMORY`, `SYSTEM_PROMPT`. |
| `AdkToolBridge` | Converts `ToolDefinition` to ADK `BaseTool`. Each tool extends `BaseTool` with `runAsync()` that delegates to the Atmosphere `ToolExecutor`. |
| `AdkBroadcastTool` | Ready-made `BaseTool` that lets an ADK agent broadcast messages to Atmosphere clients. |
| `AdkEventAdapter` | Subscribes to a `Flowable<Event>` and forwards partial streaming texts, turn completions, and errors to a `StreamingSession`. |
| `AtmosphereAdkAutoConfiguration` | Activates when `com.google.adk.runner.Runner` is on the classpath. |

### ADK-specific details

ADK requires tools to be registered at agent construction time. You cannot add tools dynamically per-request. Use `AdkAgentRuntime.configureWithTools()`:

```java
var tools = List.of(weatherTool, calendarTool);
AdkAgentRuntime.configureWithTools(settings, tools);
```

ADK only supports Gemini models natively. If you configure a non-Gemini model, `AdkAgentRuntime` logs a warning suggesting `atmosphere-spring-ai` or `atmosphere-langchain4j` instead.

### AdkBroadcastTool

The `AdkBroadcastTool` lets an ADK agent push messages directly to browser clients:

```java
// Fixed topic -- agent broadcasts to one specific broadcaster
var broadcastTool = new AdkBroadcastTool(broadcaster);

// Or dynamic topic -- agent specifies the topic at call time
var broadcastTool = new AdkBroadcastTool(broadcasterFactory);

LlmAgent agent = LlmAgent.builder()
    .name("assistant")
    .model("gemini-2.0-flash")
    .instruction("Use the broadcast tool to push updates to users")
    .tools(broadcastTool)
    .build();
```

When called by the agent, `AdkBroadcastTool.runAsync()` broadcasts the message and returns a map containing `status`, `topic`, and `recipients` count.

### AdkEventAdapter

`AdkEventAdapter` bridges ADK's RxJava `Flowable<Event>` to Atmosphere:

```java
Flowable<Event> events = runner.runAsync(userId, sessionId, userMessage);
AdkEventAdapter adapter = AdkEventAdapter.bridge(events, broadcaster);
```

The adapter handles three event types:
- **Partial events** (`event.partial() == true`): text content forwarded via `session.send()`.
- **Turn completion** (`event.turnComplete() == true`): triggers `session.complete()`.
- **Error events** (`event.errorMessage().isPresent()`): triggers `session.error()`.

## Embabel adapter

**Module:** `atmosphere-embabel`
**Package:** `org.atmosphere.ai.embabel`

Embabel is a Kotlin-based agent framework with built-in planning, tool calling, and orchestration. The `atmosphere-embabel` adapter bridges Embabel's `OutputChannel` pattern to `StreamingSession`, streaming agent events (thinking, tool calls, results) to the browser.

### Usage

Define an Embabel agent:

```java
@Agent(name = "chat-assistant", description = "Answers user questions")
public class ChatAssistantAgent {
    @Action(description = "Answer the user's question")
    public String answer(String userMessage) {
        return "Answer clearly and concisely: " + userMessage;
    }
}
```

Run it through Atmosphere:

```java
var session = StreamingSessions.start(resource);
var agent = agentPlatform.agents().stream()
        .filter(a -> "chat-assistant".equals(a.getName()))
        .findFirst().orElseThrow();

var agentRequest = new AgentRequest("chat-assistant", channel -> {
    var options = ProcessOptions.DEFAULT.withOutputChannel(channel);
    agentPlatform.runAgentFrom(agent, options, Map.of("userMessage", prompt));
    return Unit.INSTANCE;
});
Thread.startVirtualThread(() -> adapter.stream(agentRequest, session));
```

`AtmosphereOutputChannel` translates agent events (thinking, tool calls, results) into `StreamingSession` calls with appropriate `progress` / `streaming-text` / `complete` messages.

## Koog adapter

**Module:** `atmosphere-koog`
**Package:** `org.atmosphere.ai.koog`

Koog is a Kotlin agent framework with a concise DSL for defining agents, tools, and multi-step workflows. The `atmosphere-koog` adapter bridges Koog's streaming callbacks to `StreamingSession`, enabling Koog agents to stream directly to Atmosphere clients.

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-koog</artifactId>
    <version>${project.version}</version>
</dependency>
```

Koog auto-configures when `ai.koog.agents.core` is on the classpath. See `samples/spring-boot-koog-chat/` for an end-to-end example.

## Built-in runtime

`BuiltInAgentRuntime` is the zero-dependency fallback used when no adapter module is on the classpath. It talks directly to OpenAI-compatible endpoints (OpenAI, Gemini, Ollama, Azure OpenAI) via `OpenAiCompatibleClient` and supports full OpenAI function calling, streaming, and a max-5-round tool loop — so `@AiTool` methods work even without a framework adapter. Priority is `0`, so any adapter that reports `isAvailable() == true` takes precedence.

## The @AiTool annotation

All runtimes share the same framework-agnostic tool definition via `@AiTool` (in `org.atmosphere.ai.annotation`):

```java
@AiTool(name = "get_weather", description = "Get current weather for a city")
public WeatherResult getWeather(@Param("city") String city,
                                @Param(value = "unit", required = false) String unit) {
    return weatherService.lookup(city, unit);
}
```

The `ToolRegistry` discovers `@AiTool` methods at startup and creates `ToolDefinition` objects. Each adapter's tool bridge then converts these into the native format:

| Adapter | Bridge class | Native tool type |
|---------|-------------|-----------------|
| Built-in | `OpenAiCompatibleClient` | OpenAI function-calling JSON schema |
| Spring AI | `SpringAiToolBridge` | `ToolCallback` |
| LangChain4j | `LangChain4jToolBridge` | `ToolSpecification` |
| Google ADK | `AdkToolBridge` | `BaseTool` |
| Embabel | _(handled by Embabel platform)_ | Embabel `@Action` |
| Koog | `KoogToolBridge` | Koog `Tool` |

Tools are registered globally and selected per-endpoint:

```java
@AiEndpoint(path = "/chat", tools = {WeatherTools.class, CalendarTools.class})
```

## Choosing a runtime

**Built-in** is a zero-extra-dependency choice that works with any OpenAI-compatible endpoint and supports `@AiTool` function calling (max 5 tool rounds). Use it when you do not need a framework adapter's extras.

**Spring AI** is the best fit for Spring Boot applications already using the Spring AI ecosystem. It supports advisors for RAG, logging, and memory, and has the broadest model provider support via Spring AI's model starters. Spring AI handles the tool call loop automatically.

**LangChain4j** is the best fit for applications that need the LangChain4j tool ecosystem or need to work with multiple model providers without Spring. The explicit tool execution loop (via `ToolAwareStreamingResponseHandler`) gives you full control over each tool round.

**Google ADK** is the best fit for multi-agent orchestration with Gemini models. It has built-in conversation memory and agent chaining. The `AdkBroadcastTool` makes it straightforward for agents to push real-time updates to browser clients. Note that ADK requires tools at agent construction time, not per-request.

**Embabel** is the best fit for Kotlin-based agent applications that need Embabel's planning and orchestration capabilities. The `AtmosphereOutputChannel` translates agent lifecycle events into streaming texts automatically.

**Koog** is the best fit when you want a concise Kotlin DSL for defining agents and tools and already live in a Kotlin codebase.

**Microsoft Semantic Kernel** is the best fit when you're already invested in the SK ecosystem — Plugins, Planners, shared `KernelFunction` definitions across .NET and Java — or want to bind server-side SK skills to Atmosphere's streaming transport. The bridge ships tool calling via `SemanticKernelToolBridge` (auto-invoke through `ToolExecutionHelper.executeWithApproval`), conversation memory via `ChatHistory`, and embeddings via `SemanticKernelEmbeddingRuntime`.

All runtimes produce the same wire protocol on the Atmosphere side: text-by-text JSON messages delivered over WebTransport, WebSocket, SSE, or long-polling to any connected client.

## Samples

Each runtime has a corresponding sample application in the repo:

| Sample | Runtime | Source |
|--------|---------|--------|
| `spring-boot-ai-chat` | Built-in (OpenAI-compatible) | [github](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) |
| `spring-boot-ai-classroom` | Built-in, multi-client streaming | [github](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-classroom) |
| `spring-boot-ai-tools` | Built-in, `@AiTool` tool calling | [github](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-tools) |
| `spring-boot-rag-chat` | Spring AI + vector store | [github](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-rag-chat) |
| `spring-boot-koog-chat` | Koog | [github](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-koog-chat) |
| `spring-boot-dentist-agent` | Built-in + `@Agent`/`@Command` workflow | [github](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-dentist-agent) |
| `spring-boot-multi-agent-startup-team` | Coordinator + multi-agent | [github](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-multi-agent-startup-team) |

All samples share the same browser client and produce the same AI streaming wire protocol. Run any of them with `./mvnw -pl samples/<name> spring-boot:run` (add `-am` if the module is uncompiled).
