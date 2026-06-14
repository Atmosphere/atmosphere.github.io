---
title: "Anthropic"
description: "AgentRuntime backed by a native Anthropic Messages API client"
---

# Anthropic Adapter

`AgentRuntime` implementation backed by a native client that posts directly to the [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) (`https://api.anthropic.com/v1/messages`) over `java.net.http.HttpClient` — no SDK dependency, no OpenAI-compatible translation layer in between. Streaming `text_delta` events are forwarded straight to the `StreamingSession`, and Anthropic's `tool_use` → `tool_result` loop drives `@AiTool` calls.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-anthropic</artifactId>
    <version>${project.version}</version>
</dependency>
```

## How It Works

Drop the dependency alongside `atmosphere-ai` and the framework auto-detects it via `ServiceLoader`. `AnthropicAgentRuntime` has priority 100, taking precedence over the built-in client (priority 0):

```java
@AiEndpoint(path = "/ai/chat", systemPrompt = "You are a helpful assistant")
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // uses the Anthropic Messages API automatically
    }
}
```

## Configuration

The runtime reads the framework's resolved `llm.api-key`, and falls back to system properties so standalone tests and CLI usage work without an Atmosphere-wide config:

| Property | Purpose | Default |
|----------|---------|---------|
| `anthropic.api.key` | API key (falls back from `llm.api-key`) | — |
| `anthropic.version` | `anthropic-version` request header | `2023-06-01` |
| `anthropic.base.url` | Override for a sovereign / proxy endpoint | `https://api.anthropic.com` |
| `anthropic.max.tokens` | `max_tokens` on each request | client default |

The model is configured through the framework's `llm.model` setting. The runtime stays unavailable until an API key is resolved — it never advertises availability on classpath presence alone (Runtime Truth).

## Samples

- [Spring Boot AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) — drop `atmosphere-anthropic` on the classpath and the same `@AiEndpoint` code switches to Claude

## See Also

- [AI Reference](../../reference/ai/) — `AgentRuntime` SPI, `@AiEndpoint`, capability matrix, tool calling
- [Cohere Adapter](cohere/) — the other native, SDK-free runtime
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/anthropic)
