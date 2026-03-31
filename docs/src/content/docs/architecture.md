---
title: Architecture
description: How Atmosphere's transport and application layers compose
sidebar:
  order: 2
---

Atmosphere has two layers. The **transport layer** moves bytes between server and clients. The **application layer** gives those bytes meaning — AI events, tool calls, conversation memory. Understanding how they compose is key to using the framework effectively.

## The Two Layers

```
Application layer     StreamingSession, AiEvent, AgentFleet, JournalFormat
                           |
                           | emit(), stream(), complete()
                           |
                           v
Transport layer       Broadcaster, AtmosphereResource, BroadcastFilter
                           |
                           | broadcast(), suspend(), write()
                           |
                           v
Wire protocols        WebSocket, SSE, Long-Polling, gRPC
```

## Broadcaster (Transport)

A **Broadcaster** is a named pub/sub channel. Resources subscribe to it. When you call `broadcaster.broadcast(message)`, every subscribed resource receives it.

```java
@ManagedService(path = "/chat/{room}")
public class Chat {

    @Message
    public String onMessage(String message) {
        return message;  // broadcast to all in room
    }
}
```

Key properties:
- **1:N** — one message fans out to all subscribers
- **Untyped** — `broadcast(Object)` accepts anything
- **Long-lived** — persists across connections, survives reconnects
- **Transport-aware** — BroadcastFilters, BroadcasterCache, clustering (Redis, Kafka)

## StreamingSession (Application)

A **StreamingSession** represents one client's AI conversation. It produces typed events that flow through the Broadcaster to the client.

```java
@AiEndpoint(path = "/ai/chat")
public class MyBot {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.emit(new AiEvent.ToolStart("search", Map.of("q", message)));
        session.emit(new AiEvent.ToolResult("search", results));
        session.stream(message);   // invoke LLM, stream response tokens
    }
}
```

Key properties:
- **1:1** — one session serves one client's conversation
- **Typed** — `emit(AiEvent)` produces structured events (tool cards, progress, errors)
- **Short-lived** — created per prompt, closed on completion
- **Application-aware** — conversation memory, LLM runtime, tools, guardrails, metrics

## How They Compose

`StreamingSession` uses a `Broadcaster` internally. When you call `session.emit(event)`, the session serializes the event to JSON and calls `broadcaster.broadcast(new RawMessage(json))`. The Broadcaster delivers it through its filter chain to the client.

```
session.emit(new AiEvent.ToolStart(...))
    |
    v
DefaultStreamingSession serializes to JSON
    |
    v
broadcaster.broadcast(new RawMessage(json))
    |
    v
BroadcastFilter chain (PII redaction, cost metering, content safety)
    |
    v
AtmosphereResource.write() -> WebSocket frame / SSE event / HTTP chunk
```

This separation is why **AI filters work**. `PiiRedactionFilter` and `CostMeteringFilter` sit on the Broadcaster's filter chain but understand AI event types. They intercept between "session emits event" and "client receives bytes" — a hook point that only exists because the layers are separate.

## API Comparison

| | `Broadcaster` | `StreamingSession` |
|---|---|---|
| Verb | `broadcast()` | `emit()`, `stream()`, `send()` |
| Cardinality | 1:N (topic to subscribers) | 1:1 (conversation to client) |
| Lifetime | Long-lived (across connections) | Per-prompt |
| Type safety | `Object` | `AiEvent` hierarchy |
| State | Resources, filters, cache | Memory, runtime, tools, guardrails |
| Processing hooks | `BroadcastFilter` chain | `AiInterceptor` chain |

## When to Use Which

**Use `Broadcaster` directly** when you're building classic real-time features: chat rooms, dashboards, notifications, collaboration. You're working with raw messages and fan-out.

**Use `StreamingSession`** when you're building AI features: chatbots, agents, tool-calling, multi-agent orchestration. You're working with typed events and conversation state.

**Use both** when you need AI features with custom transport behavior — for example, an AI chatbot in a room where other users see the bot's responses. The session emits events, the Broadcaster fans them out to the room.

## AgentFleet (Orchestration)

A third abstraction sits above `StreamingSession` for multi-agent coordinators:

```
AgentFleet              agent(), parallel(), pipeline(), journal()
    |
    v
StreamingSession        emit(), stream(), complete()
    |
    v
Broadcaster             broadcast() -> filters -> resources
```

The `AgentFleet` dispatches work to agents and collects results. It uses the `StreamingSession` to stream progress and results back to the client. The fleet's `CoordinationJournal` records every dispatch and completion for observability.

```java
@Coordinator(name = "ceo",
        journalFormat = JournalFormat.Markdown.class)
@Fleet({@AgentRef(type = ResearchAgent.class),
        @AgentRef(type = WriterAgent.class)})
public class CeoCoordinator {

    @Prompt
    public void onPrompt(String message, AgentFleet fleet, StreamingSession session) {
        var research = fleet.agent("research").call("search", Map.of("q", message));
        session.stream("Summarize: " + research.text());
        // journal auto-emitted as a tool card via journalFormat
    }
}
```
