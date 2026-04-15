---
title: "Microsoft Semantic Kernel"
description: "AgentRuntime backed by Microsoft Semantic Kernel — ChatCompletionService, plugins, memory, and planners"
---

# Microsoft Semantic Kernel Adapter

`AgentRuntime` implementation backed by [Microsoft Semantic Kernel](https://learn.microsoft.com/en-us/semantic-kernel/) for Java. Semantic Kernel is Microsoft's enterprise-grade AI orchestration SDK with plugins, memory, and planners. Adding `atmosphere-semantic-kernel` as a dependency makes `@AiEndpoint` route streaming chat through an SK `ChatCompletionService` and makes `EmbeddingRuntime` use SK's `TextEmbeddingGenerationService`.

Semantic Kernel is the **7th runtime** added to Atmosphere in 4.0.36.

## Maven Coordinates

```xml
<properties>
    <atmosphere.version>4.0.38</atmosphere.version>
</properties>

<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-semantic-kernel</artifactId>
    <version>${atmosphere.version}</version>
</dependency>
```

You will also need Semantic Kernel's own dependencies (kernel core + the aiservices provider you want, typically OpenAI or Azure OpenAI):

```xml
<dependency>
    <groupId>com.microsoft.semantic-kernel</groupId>
    <artifactId>semantickernel-api</artifactId>
    <version>4.0.38</version>
</dependency>
<dependency>
    <groupId>com.microsoft.semantic-kernel</groupId>
    <artifactId>semantickernel-aiservices-openai</artifactId>
    <version>4.0.38</version>
</dependency>
```

## Quick Start

### AgentRuntime SPI (auto-detected)

```java
@AiEndpoint(path = "/ai/chat", systemPrompt = "You are a helpful assistant")
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // uses Semantic Kernel via ChatCompletionService
    }
}
```

Atmosphere auto-detects the `atmosphere-semantic-kernel` JAR on the classpath and routes through SK when a `ChatCompletionService` is wired.

### Wire a ChatCompletionService

```java
var chatService = OpenAIChatCompletion.builder()
        .withOpenAIAsyncClient(openAIClient)
        .withModelId("gpt-4o-mini")
        .build();

SemanticKernelAgentRuntime.setChatCompletionService(chatService);
```

The service is a JVM-level static — set it once at application startup, usually from Spring Boot / Quarkus auto-configuration.

## How It Works

`SemanticKernelAgentRuntime.execute()` builds an SK `ChatHistory` from `AgentExecutionContext.systemPrompt()` + `history()` + `message()`, calls `chatService.getStreamingChatMessageContentsAsync(...)`, and collects the resulting `Flux<StreamingChatContent>` with `blockLast()` inside the sync SPI boundary. Each content frame's `content()` text is fed into `session.send(text)`.

Text streaming, system prompts, conversation memory, structured output (via pipeline-layer schema injection), and token usage reporting all work identically to the other runtimes.

## Capability matrix

| Capability | Status | Notes |
|------------|:------:|-------|
| `TEXT_STREAMING`      | ✅ | `Flux<StreamingChatContent>` unwrapped via `blockLast()` |
| `SYSTEM_PROMPT`       | ✅ | Threaded into the `ChatHistory` |
| `CONVERSATION_MEMORY` | ✅ | Per-session memory threaded through `AgentExecutionContext` |
| `STRUCTURED_OUTPUT`   | ✅ | Via pipeline-layer schema injection (no runtime-specific support needed) |
| `TOKEN_USAGE`         | ✅ | Reported via `TokenUsage` when SK surfaces it |
| `AGENT_ORCHESTRATION` | — | Not declared. SK can participate in a `@Coordinator` fleet as a worker runtime, but it does not own a multi-agent dispatch loop the way ADK / Embabel / Koog do, so the capability flag is not advertised. |
| `TOOL_CALLING`        | — | **Deferred in 4.0.36.** SK's Java tool-calling API is still stabilizing; bridging will land in a follow-up. Documented as an honest exclusion in `modules/semantic-kernel/README.md`. |
| `TOOL_APPROVAL`       | — | Requires `TOOL_CALLING` — see above |
| `VISION`              | — | SK Java does not yet expose a stable multi-modal input API |
| `MULTI_MODAL`         | — | Same limitation |
| `PROMPT_CACHING`      | — | SK does not surface a `prompt_cache_key` pass-through |

Exclusions are **honest** — the runtime's `capabilities()` set does not advertise tool-calling, so `@AiEndpoint(requires = {TOOL_CALLING})` explicitly fails at startup when SK is the only adapter available. Correctness Invariant #5 (Runtime Truth) is preserved.

## Semantic Kernel Embedding Runtime

`atmosphere-semantic-kernel` also ships `SemanticKernelEmbeddingRuntime` for the `EmbeddingRuntime` SPI. Priority **180** places it between LC4j (190) and Embabel (170) in the embedding resolver chain.

### Wire a TextEmbeddingGenerationService

```java
var skEmbedding = OpenAITextEmbeddingGenerationService.builder()
        .withOpenAIAsyncClient(openAIClient)
        .withModelId("text-embedding-3-small")
        .build();

SemanticKernelEmbeddingRuntime.setEmbeddingService(skEmbedding);
```

The runtime calls `embeddingService.generateEmbeddingAsync(...).block()` inside the sync SPI boundary and unwraps each `Embedding.getVector()` `List<Float>` into a `float[]`. The `Mono.block()` call sits on the runtime's execution thread; callers that want non-blocking embedding should work directly with the SK service.

### VT pinning note

If you run Atmosphere on virtual threads (the default since 4.0) and are pinned to an older `reactor-core` (< 3.7), `Mono.block()` can pin the carrier thread. Spring Boot 4.0.5 ships reactor-core 3.7 which is VT-friendly. Standalone deployments should verify their reactor-core version:

```bash
./mvnw dependency:tree -pl modules/semantic-kernel | grep reactor-core
```

See the `modules/semantic-kernel/README.md` exclusion note for the full trade-off.

## Key Classes

| Class | Purpose |
|-------|---------|
| `SemanticKernelAgentRuntime` | `AgentRuntime` SPI for chat |
| `SemanticKernelEmbeddingRuntime` | `EmbeddingRuntime` SPI for embeddings |

## Samples

Semantic Kernel is wired into [spring-boot-ai-classroom](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-classroom) as one of the seven swappable runtimes. Drop the `atmosphere-semantic-kernel` JAR alongside `atmosphere-ai` and the same `@AiEndpoint` code routes through SK.

## See Also

- [AI Reference](../../reference/ai/) — `AgentRuntime` SPI, capability matrix
- [Embeddings](../../agents/embeddings/) — `EmbeddingRuntime` SPI and 5 bridges
- [Spring AI Adapter](spring-ai/)
- [LangChain4j Adapter](langchain4j/)
- [JetBrains Koog Adapter](koog/)
