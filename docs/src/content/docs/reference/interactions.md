---
title: "Interactions API"
description: "Stateful agent turns with a durable step log, background runs, and live streaming"
---

# Interactions API

An **interaction** is one stateful agent turn. It carries a stable id, a durable
`steps[]` event log, and chains to the previous turn via `previousInteractionId`
— the server holds the conversation history so the client never resends it. The
resource is layered above the `AgentRuntime` SPI, so it works for every adapter
with no per-runtime code.

It is the Atmosphere-native equivalent of a managed, retrievable agent turn:
fire a long-running run in the background, disconnect, and come back later to
`GET` its result and steps — or subscribe and watch the steps stream live.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-interactions</artifactId>
    <version>${project.version}</version>
</dependency>
```

The core (records, store SPI, service) lives in `atmosphere-interactions`; the
HTTP surface and the live-stream socket are wired by `atmosphere-spring-boot-starter`.

## HTTP Surface

All routes are under `/api/interactions`. Mutating routes are **default-deny**
(Correctness Invariant #6): they require `atmosphere.interactions.http-write-enabled=true`
and an authenticated principal.

| Method & path | Purpose |
|---------------|---------|
| `POST /api/interactions` | Create a turn (sync, or `background: true`). |
| `POST /api/interactions/{id}/continue` | Continue a turn — chains via `previousInteractionId`. |
| `GET /api/interactions/{id}` | Fetch one interaction (owner-scoped). |
| `GET /api/interactions` | List interactions (optional `?conversationId=`). |
| `POST /api/interactions/{id}/cancel` | Request cancellation of a running turn. |
| `DELETE /api/interactions/{id}` | Delete an interaction. |

```bash
# Launch a background turn
curl -X POST http://localhost:8080/api/interactions \
  -H 'Content-Type: application/json' \
  -d '{"message":"Refactor the auth module","background":true}'
# → {"id":"int-…","status":"RUNNING", …}

# Retrieve it later (durable steps[] included)
curl http://localhost:8080/api/interactions/int-…
```

## The `Interaction` Record

```java
public record Interaction(
    String id,                  // "int-<uuid>" — also the live-stream / reattach key
    String parentId,            // the interaction this one continued from (audit)
    String conversationId,      // history scope, shared across a chain
    String agentId,
    String userId,              // owner; reads/mutations are scoped to it
    String model,
    InteractionStatus status,   // CREATED, RUNNING, COMPLETED, FAILED, CANCELLED
    boolean background,
    boolean store,              // false → streamed but not persisted
    List<InteractionStep> steps,
    String finalText,
    TokenUsage usage,
    String errorMessage,
    Instant createdAt,
    Instant updatedAt
) { }
```

Each `InteractionStep` is `(long seq, String type, String text, String toolName,
Map<String,Object> data, TokenUsage usage, Instant createdAt)`. `steps[]` is the
durable observability record (text deltas coalesced, tool calls, usage); it is
**not** the prompt history — chained turns rehydrate history from
`ConversationPersistence`, keyed by `conversationId`.

## Background Runs

`background: true` persists a `RUNNING` record immediately and returns it, then
runs detached on a virtual thread. The run survives the launching connection
dropping; a CAS-guarded terminal writer records exactly one of `COMPLETED` /
`FAILED` / `CANCELLED`. Cancelling mid-run keeps the steps captured so far.

If the runtime does not advertise `CANCELLATION`, "background" honestly degrades
to "run-to-completion, retrieve after" — the capability is reported, not faked
(Runtime Truth).

## Live Streaming

A background run streams its durable steps to a subscribed browser as they are
produced, over the Atmosphere transport:

```
/atmosphere/interactions-stream?id=<interactionId>   (WebSocket / SSE)
```

On connect the handler replays the steps captured so far (late-joiner catch-up,
deduped client-side by `seq`), then pushes each new step as
`{"type":"interaction-step","step":{…}}` and, on completion, a
`{"type":"interaction-terminal","status":…,"finalText":…}` frame. Ownership is
enforced per-interaction — the same scope as the REST read.

> Reattach has a bounded live window (the in-flight run registry has a ~30-minute
> TTL); past that, the durable record still persists, so clients fall back from
> "reattach stream" to polling `GET /api/interactions/{id}`.

## `InteractionStore` Backends

| Implementation | Module | Use case |
|----------------|--------|----------|
| `InMemoryInteractionStore` | `atmosphere-interactions` | Default; lost on restart. |
| `SqliteInteractionStore` | `atmosphere-interactions` | Single-node durability (`atmosphere-interactions.db`). |
| `PostgresInteractionStore` | `atmosphere-interactions-postgres` | JDBC store; targets Postgres, works with any JSR-221 `DataSource` (operator supplies driver + pooling). |

The `InteractionStore` SPI (`save`, `appendStep`, `load`, `list`, `delete`,
`start`/`stop`) ships in-memory + SQLite + Postgres backends in-tree; other
backends (e.g. Redis) are pluggable via the SPI.

## JavaScript Client

`atmosphere.js` ships a typed client at the `atmosphere.js/interactions` subpath:

```ts
import { InteractionsClient } from 'atmosphere.js/interactions';

const ix = new InteractionsClient();

// Background turn + live step stream
const run = await ix.create({ message: 'Refactor the auth module', background: true });

const sub = await ix.subscribe(run.id, {
  onStep:     (step) => console.log(step.seq, step.type, step.text),
  onTerminal: ({ status, finalText }) => console.log('done', status, finalText),
});
// auto-closes on the terminal frame; call sub.close() to detach early

// Or poll without a socket
const final = await ix.pollUntilTerminal(run.id, { onUpdate: (i) => render(i.steps) });

// Continue the conversation (chains via previousInteractionId)
const next = await ix.continue(run.id, { message: 'Now add tests' });
```

The client also exposes `get`, `list`, `cancel`, and an async-iterator `watch(id)`.

## Configuration

| Property | Default | Effect |
|----------|---------|--------|
| `atmosphere.interactions.enabled` | `true` | Enable the auto-configuration. |
| `atmosphere.interactions.http-write-enabled` | `false` | Allow the mutating HTTP routes (default-deny). |
| `atmosphere.interactions.demo-principal` | *(unset)* | **Demo only** — inject a fixed principal so the Console can exercise the endpoints without an auth provider. Never enable in production. |

## See Also

- [`@AiEndpoint` & Streaming](/docs/tutorial/09-ai-endpoint/)
- [ExecutionHandle](execution-handle.md) — the cancellation primitive interactions build on
- [Durable Sessions](durable-sessions.md) — connection-level persistence (complementary)

## Source

- Module README: [`modules/interactions/README.md`](https://github.com/Atmosphere/atmosphere/blob/main/modules/interactions/README.md)
