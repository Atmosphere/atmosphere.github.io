---
title: "Introduction"
description: "What Atmosphere is, the @Agent programming model, AI runtimes, multi-agent orchestration, and the real-time transport layer."
sidebar:
  order: 1
---

# Introduction

Atmosphere is a transport-agnostic runtime for Java AI agents. You declare **what** your agent does — the framework handles **how** it's delivered. A single `@Agent` class can serve browsers over WebSocket, expose tools via MCP, accept tasks from other agents via A2A, stream state to frontends via AG-UI, and route messages to Slack, Telegram, or Discord — all without changing a line of code.

## The `@Agent` Programming Model

One annotation. The framework wires everything based on what's in the class and what's on the classpath.

```java
@Agent(name = "my-agent", description = "What this agent does")
public class MyAgent {

    @Prompt
    public void onMessage(String message, StreamingSession session) {
        session.stream(message);  // LLM streaming via configured backend
    }

    @Command(value = "/status", description = "Show status")
    public String status() {
        return "All systems operational";  // Executes instantly, no LLM cost
    }

    @AiTool(name = "lookup", description = "Look up data")
    public String lookup(@Param("query") String query) {
        return dataService.find(query);  // Callable by the LLM during inference
    }
}
```

### What `@Agent` Wires

What gets registered depends on which modules are on the classpath:

| Module on classpath | What gets registered |
|---|---|
| `atmosphere-agent` (required) | WebSocket endpoint at `/atmosphere/agent/my-agent` with streaming AI, conversation memory, `/help` auto-generation |
| `atmosphere-mcp` | MCP endpoint at `/atmosphere/agent/my-agent/mcp` — tools exposed to Claude, Copilot, Cursor |
| `atmosphere-a2a` | A2A endpoint at `/atmosphere/agent/my-agent/a2a` with Agent Card discovery |
| `atmosphere-agui` | AG-UI endpoint at `/atmosphere/agent/my-agent/agui` — CopilotKit-compatible |
| `atmosphere-channels` + bot token | Same agent responds on Slack, Telegram, Discord, WhatsApp, Messenger |
| (built-in) | Console UI at `/atmosphere/console/` — auto-detects the agent |

### Full-Stack vs. Headless

An `@Agent` with a `@Prompt` method gets a WebSocket UI. An `@Agent` with only `@AgentSkill` methods runs headless — A2A and MCP only, no browser endpoint. The framework detects the mode automatically.

## AI Runtimes

Write your agent once. The execution engine is determined by what's on the classpath — like Servlets run on Tomcat or Jetty without code changes.

| Runtime | Dependency |
|---------|-----------|
| Built-in | `atmosphere-ai` — OpenAI-compatible client (Gemini, OpenAI, Ollama). Zero framework overhead. |
| LangChain4j | `atmosphere-langchain4j` — ReAct tool loops, `StreamingChatModel` |
| Spring AI | `atmosphere-spring-ai` — `ChatClient`, function calling, RAG advisors |
| Google ADK | `atmosphere-adk` — `LlmAgent`, function tools, session management |
| Embabel | `atmosphere-embabel` — Goal-driven GOAP planning |
| JetBrains Koog | `atmosphere-koog` — Graph-based orchestration, `AIAgent` |
| Microsoft Semantic Kernel | `atmosphere-semantic-kernel` — `ChatCompletionService` with streaming + embeddings |

Seven runtimes share one `AgentRuntime` SPI. Switching backends is
one dependency change. Your `@Agent`, `@AiTool`, `@Command`, skill
files, conversation memory, guardrails, and protocol exposure stay
the same. See [AI Adapters](/docs/tutorial/11-ai-adapters/) for the
full capability matrix (pinned per-runtime in
`AbstractAgentRuntimeContractTest.expectedCapabilities()`).

## Multi-Agent Orchestration

`@Coordinator` manages a fleet of agents. Declare the fleet, inject `AgentFleet`, and orchestrate with plain Java — sequential, parallel, conditional, or any pattern.

```java
@Coordinator(name = "ceo")
@Fleet({
    @AgentRef(type = ResearchAgent.class),
    @AgentRef(type = StrategyAgent.class),
    @AgentRef(type = FinanceAgent.class)
})
public class CeoCoordinator {

    @Prompt
    public void onPrompt(String message, AgentFleet fleet, StreamingSession session) {
        var research = fleet.agent("research").call("web_search", Map.of("query", message));
        var results = fleet.parallel(
            fleet.call("strategy", "analyze", Map.of("data", research.text())),
            fleet.call("finance", "model", Map.of("market", message))
        );
        session.stream("Synthesize: " + research.text() + results.get("strategy").text());
    }
}
```

The fleet handles transport automatically — local agents call directly (no HTTP), remote agents use A2A JSON-RPC. Features include coordination journal, agent handoffs, conditional routing, result evaluation, long-term memory, and eval assertions. See [@Coordinator](/docs/agents/coordinator/) for the full guide.

## Human-in-the-Loop

Tools that require human approval before execution use `@RequiresApproval`:

```java
@AiTool(name = "delete_account", description = "Permanently delete a user account")
@RequiresApproval("This will permanently delete the account. Are you sure?")
public String deleteAccount(@Param("accountId") String accountId) {
    return accountService.delete(accountId);
}
```

The virtual thread parks cheaply until the client approves or denies. See [@AiTool & Human-in-the-Loop](/docs/tutorial/10-ai-tools/) for the wire protocol and frontend handling.

## Real-Time Foundation

Atmosphere has been in continuous development since 2008. The AI agent layer is built on top of a battle-tested real-time transport infrastructure that also powers non-AI applications:

- **Transports** — WebSocket, SSE, Long-Polling, gRPC with automatic fallback and reconnection
- **Broadcaster** — Pub/sub hub that delivers messages to all subscribers regardless of transport
- **Rooms & Presence** — Named rooms with join/leave lifecycle and message history
- **@ManagedService** — The original annotation-driven programming model (fully compatible with `@Agent`)

See [Real-Time Infrastructure](/docs/tutorial/03-managed-service/) for details.

## Module Map

| Module | Artifact | Description |
|--------|----------|-------------|
| Agent | `atmosphere-agent` | `@Agent`, `@Command`, `@Prompt`, protocol auto-wiring |
| AI | `atmosphere-ai` | `AgentRuntime` SPI, `@AiTool`, conversation memory, compaction, artifacts |
| Coordinator | `atmosphere-coordinator` | `@Coordinator`, `@Fleet`, `AgentFleet`, coordination journal |
| MCP | `atmosphere-mcp` | Model Context Protocol server (tools, resources, prompts) |
| A2A | `atmosphere-a2a` | Agent-to-Agent protocol (Agent Card, JSON-RPC task delegation) |
| AG-UI | `atmosphere-agui` | Agent-User Interaction (SSE event streaming, CopilotKit-compatible) |
| Channels | `atmosphere-channels` | Slack, Telegram, Discord, WhatsApp, Messenger |
| Core Runtime | `atmosphere-runtime` | Broadcaster, AtmosphereResource, transports |
| Spring Boot | `atmosphere-spring-boot-starter` | Auto-configuration for Spring Boot 4.0+ |
| Quarkus | `atmosphere-quarkus-extension` | Build-time extension for Quarkus 3.31.3 |
| LangChain4j | `atmosphere-langchain4j` | LangChain4j adapter |
| Spring AI | `atmosphere-spring-ai` | Spring AI adapter |
| ADK | `atmosphere-adk` | Google ADK adapter |
| Embabel | `atmosphere-embabel` | Embabel adapter |
| Koog | `atmosphere-koog` | JetBrains Koog adapter |
| Semantic Kernel | `atmosphere-semantic-kernel` | Microsoft Semantic Kernel adapter |
| Durable Sessions | `atmosphere-durable-sessions` | Session persistence (SQLite, Redis) |
| Client | `atmosphere.js` | TypeScript client — React, Vue, Svelte, React Native |

## Next Steps

Start with [@Agent & @Prompt](/docs/agents/agent/) to learn the core programming model, then continue to [@AiTool & Human-in-the-Loop](/docs/tutorial/10-ai-tools/) for tool calling and approval gates.
