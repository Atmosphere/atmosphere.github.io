---
title: "CrewAI"
description: "AgentRuntime bridging CrewAI Python crews over an HTTP/SSE sidecar"
---

# CrewAI Adapter

`AgentRuntime` for the [CrewAI](https://www.crewai.com/) multi-agent framework. Java does not embed Python — instead the runtime talks to a **CrewAI sidecar process** over HTTP + SSE. This is the same pattern many JVM teams use to bring Python-native agent frameworks (CrewAI, AutoGen, LlamaIndex) into Java services without rewriting the agent logic.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-crewai</artifactId>
    <version>${project.version}</version>
</dependency>
```

## How It Works

Drop the dependency alongside `atmosphere-ai` and the framework auto-detects it via `ServiceLoader`. `CrewAiAgentRuntime` drives the sidecar; streamed tokens flow back to the `StreamingSession`:

```java
@AiEndpoint(path = "/ai/chat", systemPrompt = "You are a helpful assistant")
public class MyChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // dispatched to the CrewAI sidecar
    }
}
```

The Python sidecar (`atmosphere-crewai-bridge`, shipped in the module's `sidecar/` directory) speaks the wire protocol and materialises Java `@AiTool` descriptors as native `crewai.tools.BaseTool` subclasses.

## Configuration — sidecar URL

The runtime stays **unavailable out of the box**: `isAvailable()` returns `false` until you point `ATMOSPHERE_CREWAI_SIDECAR_URL` at a running sidecar that responds OK to `GET /health`. This is deliberate (Runtime Truth) — the runtime never advertises availability based on the classpath alone.

```bash
export ATMOSPHERE_CREWAI_SIDECAR_URL=http://localhost:8089
```

## Bidirectional Tool Bridge

When CrewAI invokes a Java `@AiTool`, the sidecar POSTs back to a loopback-only `ToolCallbackServer` inside the JVM. Those calls route through `ToolExecutionHelper.executeWithApproval`, so approval gates, validation, and governance apply identically to the in-process tool path. `context.systemPrompt()` is threaded into every agent's `backstory` inside a delimited block so the directive stays distinguishable from user prose.

Cancellation is process-less: cancelling the session issues a `DELETE` on the sidecar session id rather than killing a process.

## Samples

- [Spring Boot AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) — drop `atmosphere-crewai` on the classpath and point `ATMOSPHERE_CREWAI_SIDECAR_URL` at a running sidecar

## See Also

- [AI Reference](../../reference/ai/) — `AgentRuntime` SPI, `@AiEndpoint`, capability matrix, tool calling
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/crewai) — wire protocol, sidecar setup, test suites
