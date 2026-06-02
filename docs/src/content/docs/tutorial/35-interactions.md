---
title: "Stateful Interactions"
description: "Stateful agent turns with a durable step log, background runs you can disconnect from, conversation chaining, and a live step stream — built on the AgentRuntime SPI"
---

# Stateful Interactions

Most agent calls in this tutorial stream a single turn to the connected client
and finish when the request does. An **interaction** lifts that into a *managed,
retrievable* turn: it has a stable id, a durable `steps[]` event log, and it
chains to the previous turn so the server — not your client — holds the
conversation history. You can fire a long-running turn in the **background**,
disconnect, and come back later to read its result and steps, or subscribe and
watch the steps arrive **live**.

The whole resource is layered above the `AgentRuntime` SPI, so it works for every
adapter (Built-in, LangChain4j, Spring AI, …) with no per-runtime code.

## Add the dependency

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-interactions</artifactId>
    <version>${project.version}</version>
</dependency>
```

In a Spring Boot app the starter auto-configures the service, an in-memory store,
and the `/api/interactions` HTTP surface. The mutating routes are **default-deny**
— enable them explicitly for local use:

```yaml
atmosphere:
  interactions:
    http-write-enabled: true       # allow POST/DELETE (default false)
    demo-principal: demo-user      # DEMO ONLY — inject a fixed caller; never in prod
```

## A synchronous turn

The simplest call runs to completion and returns the finished record:

```bash
curl -X POST http://localhost:8080/api/interactions \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarise the README in three bullets"}'
```

```json
{
  "id": "int-7f3c…",
  "status": "COMPLETED",
  "conversationId": "conv-…",
  "finalText": "- …\n- …\n- …",
  "steps": [
    { "seq": 0, "type": "text",       "text": "- …" },
    { "seq": 1, "type": "completion", "text": "- …\n- …\n- …" }
  ],
  "usage": { "input": 412, "output": 60, "total": 472 }
}
```

`steps[]` is the durable observability log — coalesced text, tool calls, usage —
retrievable for the life of the record. It is deliberately *not* the prompt
history; chained turns rehydrate history from `ConversationPersistence`.

## A background turn you can walk away from

A long task should not hold a connection open. Set `background: true` and the
server persists a `RUNNING` record immediately and returns it:

```bash
curl -X POST http://localhost:8080/api/interactions \
  -H 'Content-Type: application/json' \
  -d '{"message":"Refactor the auth module and add tests","background":true}'
# → {"id":"int-9a…","status":"RUNNING", …}
```

The run continues on a virtual thread even if your connection drops. Poll it
whenever you like:

```bash
curl http://localhost:8080/api/interactions/int-9a…
# status flips RUNNING → COMPLETED (or FAILED / CANCELLED); steps[] grows
```

A single CAS-guarded terminal writer records exactly one terminal state, so a
racing completion and error collapse to one record. Cancelling mid-run
(`POST /api/interactions/int-9a…/cancel`) keeps the steps captured so far.

## Continuing the conversation

`continue` starts a new turn that inherits the prior turn's `conversationId` and
its LLM history — you send only the new message:

```bash
curl -X POST http://localhost:8080/api/interactions/int-9a…/continue \
  -H 'Content-Type: application/json' \
  -d '{"message":"Now wire it into the login endpoint"}'
```

The follow-up records `previousInteractionId` as its `parentId` — an audit
breadcrumb across the chain.

## Watching steps arrive live

A background run streams its durable steps to a subscribed browser as they are
produced, over the Atmosphere transport:

```
/atmosphere/interactions-stream?id=<interactionId>      (WebSocket / SSE)
```

On connect the handler **replays the steps captured so far** (so a late joiner
catches up, deduped by sequence), then pushes each new step and a terminal frame
on completion. Ownership is enforced per-interaction — the same scope as the REST
read, resolved through an `AtmosphereInterceptor` so it holds across every
transport (a servlet filter's request attribute does not survive the WebSocket
upgrade).

> The live window is bounded (the in-flight run registry has a ~30-minute TTL).
> Past it the durable record still exists, so clients fall back from "reattach
> stream" to polling `GET /api/interactions/{id}`.

## From the browser with atmosphere.js

```ts
import { InteractionsClient } from 'atmosphere.js/interactions';

const ix = new InteractionsClient();

const run = await ix.create({ message: 'Refactor the auth module', background: true });

const sub = await ix.subscribe(run.id, {
  onStep:     (step) => appendToTimeline(step),          // deduped, replay + live merged
  onTerminal: ({ status, finalText }) => finish(status, finalText),
});
// the subscription auto-closes on the terminal frame; sub.close() detaches early

// No socket? Poll instead — same record shape:
const final = await ix.pollUntilTerminal(run.id, { onUpdate: (i) => render(i.steps) });

// Continue the thread:
const next = await ix.continue(run.id, { message: 'Now add tests' });
```

`subscribe` defaults to WebSocket with an SSE fallback. The client also exposes
`get`, `list`, `cancel`, and an async-iterator `watch(id)`.

## See it in the Console

Any sample that includes `atmosphere-interactions` gains an **Interactions** tab
in the Atmosphere Console (`/atmosphere/console/`). Launch a background turn and
the Console subscribes to the stream and renders the durable step timeline live,
with metadata (owner, model, conversation), a copy-id control, and a continue
box. Two samples wire it up:

- [`spring-boot-coding-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-coding-agent)
  — a long-running coding task streamed live.
- [`spring-boot-multi-agent-startup-team`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-multi-agent-startup-team)
  — a multi-agent run kicked off as a background interaction.

## Persistence

| Store | Use case |
|-------|----------|
| `InMemoryInteractionStore` | Default; lost on restart. |
| `SqliteInteractionStore` | Single-node durability (`atmosphere-interactions.db`). |

Both ship in `atmosphere-interactions`. The `InteractionStore` SPI is pluggable
for other backends (Redis, Postgres); those are not in-tree.

## See also

- [Interactions API reference](../../reference/interactions/) — full record, route, and SPI reference
- [`@AiEndpoint` & Streaming](09-ai-endpoint.md) — the streaming foundation interactions build on
- [ExecutionHandle](../../reference/execution-handle/) — the cancellation primitive behind background cancel
- [Durable Sessions](17-durable-sessions.md) — connection-level persistence (complementary)
