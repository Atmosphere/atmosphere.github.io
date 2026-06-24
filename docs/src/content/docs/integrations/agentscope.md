---
title: "Alibaba AgentScope"
description: "AgentRuntime backed by AgentScope Java ReActAgent"
---

# Alibaba AgentScope Adapter

`AgentRuntime` implementation backed by [AgentScope Java](https://github.com/agentscope-ai/agentscope-java)
(Tongyi Lab) `ReActAgent`. When this JAR is on the classpath, `@AiEndpoint` runs AgentScope agents and streams their output to browser clients in real-time over Atmosphere's transport.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-agentscope</artifactId>
    <version>${project.version}</version>
</dependency>
<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope-core</artifactId>
    <version>${agentscope.version}</version>
</dependency>
```

## How It Works

Drop the dependency alongside `atmosphere-ai` and the framework auto-detects it via `ServiceLoader`. The `AgentScopeAgentRuntime` has priority 100, taking precedence over the built-in client (priority 0):

```java
@AiEndpoint(path = "/ai/chat", systemPrompt = "You are a helpful assistant")
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // uses AgentScope automatically
    }
}
```

## Spring Boot Auto-Configuration

`AtmosphereAgentScopeAutoConfiguration` builds an `OpenAIChatModel` and a `ReActAgent` automatically when `llm.api-key` is set, so the default `spring-boot-ai-chat` template runs unchanged:

```yaml
llm:
  api-key: ${OPENAI_API_KEY}
  base-url: https://api.openai.com/v1
  model: gpt-4o-mini
```

Override the system prompt with `atmosphere.agentscope.system-prompt` (it falls back to `llm.system-prompt`). For full control, declare your own `ReActAgent` `@Bean` — the auto-configuration detects it via `@ConditionalOnMissingBean` and skips the default.

## Per-Request Extension

`AgentScopeAgent` lets a single request route through a different `ReActAgent` topology (for example a planner agent vs. a quick-lookup agent) without re-installing the runtime client. See the [AI Reference](../../reference/ai/) for the per-request sidecar pattern.

## Runtime Caveat

AgentScope is exposed as a streaming `AgentRuntime`. As of the bundled AgentScope version it has **no native tool dispatch** through Atmosphere's `@AiTool` bridge — for `@AiTool`-driven tool calling, pick a tool-capable runtime (Built-in, Spring AI, LangChain4j, ADK, Koog, Semantic Kernel, Anthropic, or Cohere). See the [per-runtime capability matrix](../../reference/ai/) for the authoritative set.

## Samples

- [Spring Boot AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) — drop `atmosphere-agentscope` on the classpath and the same `@AiEndpoint` code switches to AgentScope

## Native structured output

When an `@AiEndpoint` declares `responseAs = SomeRecord.class`, this runtime enforces the schema at the **provider** level via AgentScope's schema-aware `stream(msgs, opts, responseType)` overload (which drives the formatter's `ResponseFormat.jsonSchema(…)` / structured-output tool) — the model cannot emit non-conforming JSON. This is the `NATIVE_STRUCTURED_OUTPUT` capability; activation is governed by `NativeStructuredOutputMode` (AUTO default), which falls back gracefully to the prompt-injection path if the provider rejects the schema.

## See Also

- [AI Reference](../../reference/ai/) — `AgentRuntime` SPI, `@AiEndpoint`, capability matrix, per-request extensions
- [Spring AI Alibaba Adapter](spring-ai-alibaba/)
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/agentscope)
