---
title: "Spring AI"
description: "AgentRuntime backed by Spring AI ChatClient"
---

# Spring AI Adapter

`AgentRuntime` implementation backed by Spring AI `ChatClient`. When this JAR is on the classpath, `@AiEndpoint` automatically uses Spring AI for streaming.

## Maven Coordinates

```xml
<properties>
    <atmosphere.version>4.0.36-SNAPSHOT</atmosphere.version>
</properties>

<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-spring-ai</artifactId>
    <version>${atmosphere.version}</version>
</dependency>
```

## How It Works

Drop the dependency alongside `atmosphere-ai` and the framework auto-detects it via `ServiceLoader`:

```java
@AiEndpoint(path = "/ai/chat", systemPrompt = "You are a helpful assistant")
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // uses Spring AI ChatClient automatically
    }
}
```

No code changes needed -- the `SpringAiAgentRuntime` implementation has priority 100, which takes precedence over the built-in client (priority 0).

## Direct Usage

For full control, use `SpringAiStreamingAdapter` directly:

```java
var session = StreamingSessions.start(resource);
springAiAdapter.stream(chatClient, prompt, session);
```

With advisors:

```java
springAiAdapter.stream(chatClient, prompt, session, myAdvisor);
```

With a customizer:

```java
springAiAdapter.stream(chatClient, prompt, session, spec -> {
    spec.system("Custom system prompt");
});
```

## Spring Boot Auto-Configuration

`AtmosphereSpringAiAutoConfiguration` provides:

- `SpringAiStreamingAdapter` bean
- `SpringAiAgentRuntime` bridge bean (connects Spring-managed `ChatClient` to the SPI)

The `ChatClient` bean must be configured separately via Spring AI's own starter.

## Samples

- [Spring Boot AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) -- drop `atmosphere-spring-ai` on the classpath and the same `@AiEndpoint` code switches to Spring AI

## See Also

- [AI Reference](../../reference/ai/) -- `AgentRuntime` SPI, `@AiEndpoint`, filters, routing
- [LangChain4j Adapter](langchain4j/)
- [Google ADK Adapter](adk/)
- [Embabel Adapter](embabel/)
