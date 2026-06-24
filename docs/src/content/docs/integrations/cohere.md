---
title: "Cohere"
description: "AgentRuntime backed by a native Cohere v2 Chat API client"
---

# Cohere Adapter

`AgentRuntime` implementation backed by a native client that posts directly to the [Cohere v2 Chat API](https://docs.cohere.com/v2/reference/chat) (`POST /v2/chat`) over `java.net.http.HttpClient` — no SDK dependency, no OpenAI-compatible translation layer in between. The runtime forwards Cohere's native SSE event types (`content-delta`, `tool-plan-delta`, `tool-call-start`, `tool-call-delta`, `citation-start`), so streaming "thinking" tokens and RAG citations render on the client without lossy translation through an OpenAI-shaped proxy.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-cohere</artifactId>
    <version>${project.version}</version>
</dependency>
```

## How It Works

Drop the dependency alongside `atmosphere-ai` and the framework auto-detects it via `ServiceLoader`. `CohereAgentRuntime` has priority 100, taking precedence over the built-in client (priority 0):

```java
@AiEndpoint(path = "/ai/chat", systemPrompt = "You are a helpful assistant")
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // uses the Cohere v2 Chat API automatically
    }
}
```

## Configuration

Set the API key via the framework's `llm.api-key`, an environment variable, or a system property:

```bash
export LLM_API_KEY=your-cohere-key
# or, equivalently:
java -Dcohere.api.key=your-cohere-key -jar app.jar
```

The runtime registers itself at priority 100 and the framework picks it up when the jar is on the classpath alongside a configured key.

### Sovereign / self-hosted endpoint

Point the runtime at any environment that speaks the Cohere v2 wire protocol (for example [Command A+](https://cohere.com/blog/command-a-plus) deployed on customer infrastructure) by overriding `cohere.base.url`.

## Samples

- [Spring Boot AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) — drop `atmosphere-cohere` on the classpath and the same `@AiEndpoint` code switches to Cohere

## Native structured output

When an `@AiEndpoint` declares `responseAs = SomeRecord.class`, this runtime enforces the schema at the **provider** level via Cohere v2's `response_format` field (`{"type":"json_object","schema":{…}}`) — the model cannot emit non-conforming JSON. This is the `NATIVE_STRUCTURED_OUTPUT` capability; activation is governed by `NativeStructuredOutputMode` (AUTO default), which falls back gracefully to the prompt-injection path if the provider rejects the schema.

## See Also

- [AI Reference](../../reference/ai/) — `AgentRuntime` SPI, `@AiEndpoint`, capability matrix, tool calling
- [Anthropic Adapter](anthropic/) — the other native, SDK-free runtime
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/cohere)
