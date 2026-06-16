---
title: "Spring AI Alibaba"
description: "AgentRuntime backed by Spring AI Alibaba ReactAgent"
---

# Spring AI Alibaba Adapter

`AgentRuntime` implementation backed by [Spring AI Alibaba](https://github.com/alibaba/spring-ai-alibaba)
(Alibaba Cloud AI) `ReactAgent`. Spring AI Alibaba extends Spring AI with multi-agent orchestration patterns (`SequentialAgent`, `ParallelAgent`, `RoutingAgent`, `LoopAgent`) and a graph runtime; this adapter exposes them through `@AiEndpoint`.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-spring-ai-alibaba</artifactId>
    <version>${project.version}</version>
</dependency>
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>spring-ai-alibaba-agent-framework</artifactId>
    <version>${spring-ai-alibaba.version}</version>
</dependency>
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-openai</artifactId>
    <version>${spring-ai-alibaba-spring-ai.version}</version>
</dependency>
```

## How It Works

Drop the dependency alongside `atmosphere-ai` and the framework auto-detects it via `ServiceLoader`. `AtmosphereSpringAiAlibabaAutoConfiguration` wires the `ReactAgent` into the SPI when running under Spring Boot:

```java
@AiEndpoint(path = "/ai/chat", systemPrompt = "You are a helpful assistant")
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // uses Spring AI Alibaba automatically
    }
}
```

## Buffered Streaming — Important

Spring AI Alibaba's `ReactAgent.call(List<Message>) → AssistantMessage` is **synchronous** as of v1.1.2.2; there is no native `Flux<...>` streaming agent method. This adapter wraps `call(...)` and delivers the full reply as a single `session.send(text)` chunk followed by `session.complete()`. The Atmosphere transport still frames that chunk as a streamed message, so the UI sees a streaming response — but **there are no incremental token deltas from the LLM**.

If token-by-token streaming matters, drive Spring AI's `StreamingChatModel` directly via [`atmosphere-spring-ai`](spring-ai/). You will lose Spring AI Alibaba's multi-agent / graph orchestration patterns; that's the trade.

## Requirements — Spring Boot 3 only today

Spring AI Alibaba `1.1.2.2` is compiled against Spring AI `1.1.6`, which pins the Spring Boot 3-era FQN of `RestClientAutoConfiguration` (Spring Boot 4 ships it at a renamed FQN). Run this adapter under a Spring Boot 3 application:

```bash
cd samples/spring-boot-ai-chat
./mvnw -Pspring-boot3 spring-boot:run
```

A Spring Boot 4 path becomes possible once Alibaba publishes a Spring AI 2.x-aligned `spring-ai-alibaba-agent-framework`. The sibling [`atmosphere-agentscope`](agentscope/) adapter is unaffected and works on Spring Boot 4.

## Per-Request Extension

`SpringAiAlibabaRunnableConfig` exposes Alibaba's per-invocation `RunnableConfig` — `threadId` (memory-thread continuation), `checkPointId` (resume), `streamMode`, metadata, and store. See the [AI Reference](../../reference/ai/) for the per-request sidecar pattern.

## Samples

- [Spring Boot AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) — run with `-Pspring-boot3` and drop `atmosphere-spring-ai-alibaba` on the classpath

## See Also

- [AI Reference](../../reference/ai/) — `AgentRuntime` SPI, `@AiEndpoint`, capability matrix, per-request extensions
- [Spring AI Adapter](spring-ai/) — for token-by-token streaming
- [Alibaba AgentScope Adapter](agentscope/)
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/spring-ai-alibaba)
