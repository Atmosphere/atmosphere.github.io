---
title: "What's New in 4.0"
description: "Highlights from the Atmosphere 4.0.x release line"
---

# What's New in Atmosphere 4.0

Atmosphere 4.0 is the JDK 21+ rewrite of the framework. The 4.0.0 release shipped the
core platform migration (Jakarta EE 10, virtual threads, Jetty 12 / Tomcat 11, native
image support, rooms, AI streaming SPI, MCP, TypeScript client). Since then the 4.0.x
line has grown into a full multi-agent runtime — unified agent annotations, six
pluggable AI runtimes, orchestration primitives, WebTransport/HTTP3, React Native
support, and major compatibility refreshes.

The latest build tracks **Spring Boot 4.0.5 (Spring Framework 6.2.8)**, **Quarkus 3.31.3**,
**Jackson 3.1.1**, and **atmosphere.js 5.0.22**, and requires **JDK 21** as a minimum.

This page is a highlights reel. For the per-patch history, see the
[CHANGELOG](https://github.com/Atmosphere/atmosphere/blob/main/CHANGELOG.md).

## AI, Agents & Orchestration

### `@Agent` + `@Command` — one annotation, every channel

- **`@Agent`** is the single entry point that wires `@AiEndpoint`, commands, tools,
  skill files, conversation memory, and multi-protocol exposure (MCP, A2A, AG-UI)
  based on classpath detection. Conversation memory is on by default. See
  [@Agent](/docs/agents/agent/).
- **`@Command`** defines slash commands once and routes them across **Web
  (WebSocket), Slack, Telegram, Discord, WhatsApp, and Messenger** when
  `atmosphere-channels` is on the classpath. Confirmation flow for destructive
  actions and auto-generated `/help` are included.
- **`skill.md`** files act as both the LLM system prompt and agent metadata.
  Sections like `## Skills`, `## Tools`, `## Channels`, and `## Guardrails` are
  parsed into A2A Agent Cards, MCP tool manifests, and channel validation. See
  [Skills](/docs/agents/skills/).
- **`atmosphere-agent`** is the module hosting the annotation processor,
  `CommandRouter`, `SkillFileParser`, and `AgentHandler`.

### `AgentRuntime` SPI — the Servlet model for AI agents

- **`AgentRuntime` replaces the earlier `AiSupport` SPI.** It dispatches the entire
  agent loop — tool calling, memory, RAG, retries — to whichever AI framework is on
  the classpath. Write your `@Agent` once, run it on any runtime. Switch runtimes by
  changing a single Maven dependency.
- **Six runtimes** share a unified capability baseline (tool calling, structured
  output, progress events, usage metadata): **Built-in**, **LangChain4j**,
  **Spring AI**, **Google ADK**, **Embabel**, and the new **JetBrains Koog**
  adapter. The built-in runtime gained full OpenAI-compatible tool calling
  (max 5 rounds), so `@AiTool` works with zero framework dependencies.
- **Auto-detection** via `ServiceLoader` — the highest-`priority()` runtime that
  reports `isAvailable()` wins. The AI Console subtitle and `/api/console/info`
  report the active runtime.
- **Usage metadata** (`ai.tokens.input`, `ai.tokens.output`, `ai.tokens.total`) is
  reported by every runtime that exposes it, and flows into `MicrometerAiMetrics`.
- **`AiCapability` negotiation** — `@AiEndpoint(requires = {TOOL_CALLING})` fails
  fast at startup if the active runtime can't satisfy required capabilities.

### Orchestration primitives for multi-agent systems

- **`@Coordinator` + `@Fleet` + `@AgentRef`** — declarative multi-agent
  coordinators. Parallel fan-out, sequential pipelines, optional agents, weighted
  routing, and circular-dependency detection are built in. See
  [@Coordinator](/docs/agents/coordinator/).
- **`AgentFleet` API** — injected into `@Prompt` methods. `fleet.parallel(...)`
  fans out concurrently; `fleet.pipeline(...)` chains sequentially. Results are
  returned as `AgentResult` records with text, metadata, duration, and success
  status.
- **Local + Remote transport** — coordinators transparently call local agents via
  direct invocation or remote agents via A2A JSON-RPC. The `AgentProxy` abstraction
  hides the transport layer.
- **Agent handoffs** — `session.handoff("billing", message)` transfers a
  conversation with its full history, with a cycle guard and an
  `AiEvent.Handoff` emitted for observability.
- **Approval gates** — `@RequiresApproval` parks the virtual thread until a client
  approves or denies the action via the `/__approval/` protocol.
- **Conditional routing** — `fleet.route(result, spec)` uses first-match
  evaluation with journal recording.
- **Long-term memory** — `LongTermMemoryInterceptor` with pluggable extraction
  strategies (on-session-close, per-message, periodic).
- **Eval assertions** — `LlmJudge` exposes `meetsIntent()`, `isGroundedIn()`, and
  `hasQuality()` for LLM-as-judge testing.

### Streaming, tools, and events

- **`AiEvent` sealed interface** — 13 structured event types (`TextDelta`,
  `ToolStart`, `ToolResult`, `AgentStep`, `EntityStart`, `StructuredField`,
  `Handoff`, and more) delivered via `StreamingSession.emit()`, powering rich
  real-time UIs.
- **`@AiTool` framework-agnostic tool calling** — declare tools once with
  `@AiTool`/`@Param`, portable across every backend via bridge adapters
  (`SpringAiToolBridge`, `LangChain4jToolBridge`, `AdkToolBridge`,
  `AtmosphereToolBridge` for Koog). `ToolRegistry.execute(name, args, session)`
  auto-emits `ToolStart`/`ToolResult` through the streaming session.
- **Per-endpoint model override** — `@AiEndpoint(model = "gpt-4o")` selects a
  model per endpoint without touching global config.
- **Multi-backend routing** — `@AiEndpoint(fallbackStrategy = FAILOVER)` wires
  `DefaultModelRouter` for failover, round-robin, or content-based routing.
- **Auto-detected `ConversationPersistence`** — `conversationMemory = true`
  discovers Redis or SQLite backends via `ServiceLoader`; falls back to in-memory.
- **Memory strategies** — pluggable `MemoryStrategy` SPI with
  `MessageWindowStrategy`, `TokenWindowStrategy`, and `SummarizingStrategy`.
- **`StructuredOutputParser` SPI** — generate JSON Schema instructions from Java
  classes, parse LLM output into typed objects. `JacksonStructuredOutputParser`
  works with any model.
- **Enhanced RAG** — `ContextProvider.transformQuery()` and `rerank()` enable
  query rewriting and result re-ranking without a custom pipeline;
  `InMemoryContextProvider` gives a zero-dependency provider for development.
- **First-class identity fields** — `AiRequest` carries `userId`, `sessionId`,
  `agentId`, and `conversationId` as explicit fields instead of an untyped
  `hints()` map.
- **AiMetrics SPI** — `MetricsCapturingSession` records first-streaming-text
  latency, streaming text usage, and errors via a pluggable, ServiceLoader-
  discovered `AiMetrics` interface.
- **Cache replay coalescing** — reconnecting clients receive coalesced missed
  streaming texts in a single batch.
- **Streaming text budget management** — `StreamingTextBudgetManager` enforces
  per-session and per-endpoint limits.
- **Cost metering UI** — per-message cost badges in the chat frontend via
  `StreamingSession` request attributes.
- **`atmosphere-ai-test`** — `AiTestClient`, `AiResponse`, and fluent
  `AiAssertions` for testing AI endpoints in JUnit 5. See
  [AI Testing](/docs/reference/testing/).

## Runtime & Transport

- **WebTransport over HTTP/3** — Atmosphere now ships an HTTP/3 + WebTransport
  transport, sitting alongside WebSocket, SSE, long-polling, and gRPC on the same
  Broadcaster. See [WebTransport Reference](/docs/reference/webtransport/).
- **gRPC transport** — bidirectional streaming on the same Broadcaster as the
  classic transports.
- **Virtual threads on by default** — `ExecutorsFactory` uses
  `Executors.newVirtualThreadPerTaskExecutor()`, and `DefaultBroadcaster` plus 16
  other core classes migrated from `synchronized` blocks to `ReentrantLock` to
  avoid pinning. Opt out with `ApplicationConfig.USE_VIRTUAL_THREADS=false`.
- **Rooms & presence** — `RoomManager` with join/leave, presence events, message
  history, AI virtual members, and a room protocol backed by sealed records
  (`Join`, `Leave`, `Broadcast`, `Direct`).
- **`RawMessage` API** — first-class public wrapper for pre-encoded messages that
  bypass `@Message` decoder/encoder pipelines, used by the room protocol to avoid
  JSON envelope mangling. `ManagedAtmosphereHandler.Managed` is deprecated in
  favor of `RawMessage`.
- **Backpressure** — `BackpressureInterceptor` protects against slow clients with
  a configurable high-water mark (default 1000 pending messages) and
  `drop-oldest`, `drop-newest`, or `disconnect` policies.

## Cloud, Persistence & Observability

- **Clustering** — Redis (Lettuce 6.x, non-blocking pub/sub) and Kafka
  broadcasters for multi-node deployments.
- **Durable sessions** — survive restarts with InMemory, SQLite, or Redis-backed
  `SessionStore` implementations; room memberships and broadcaster subscriptions
  are restored on reconnection.
- **Micrometer metrics** (`AtmosphereMetrics`) — gauges, counters, and timers for
  active connections, broadcasters, broadcast latency, room-level gauges, cache
  hit/miss/eviction, and backpressure drop/disconnect.
- **OpenTelemetry tracing** (`AtmosphereTracing`) — per-request spans with
  `atmosphere.resource.uuid`, `atmosphere.transport`, `atmosphere.action`,
  `atmosphere.broadcaster`, and `atmosphere.room` attributes.
- **Health check** (`AtmosphereHealth`) — framework-level snapshot exposed via
  the Spring Boot Actuator `AtmosphereHealthIndicator`.
- **MDC interceptor** — sets `atmosphere.uuid`, `atmosphere.transport`, and
  `atmosphere.broadcaster` in the SLF4J MDC for structured logging.

## Integrations

- **Spring Boot 4.0.5 (Spring Framework 6.2.8)** — auto-configuration, Actuator
  health indicator (`AtmosphereHealthIndicator`), and GraalVM AOT runtime hints
  (`AtmosphereRuntimeHints`). Spring Boot 4.0 is modularized, so the starter now
  depends explicitly on `spring-boot-servlet`, `spring-boot-web-server`, and
  `spring-boot-health` where needed. The starter overrides the parent POM's old
  SLF4J 1.x/Logback 1.2.x pins in `<dependencies>` so upgrades don't regress.
  See [Spring Boot Reference](/docs/integrations/spring-boot/).
- **Quarkus 3.31.3** — build-time Jandex annotation scanning, Arc CDI
  integration, custom `QuarkusJSR356AsyncSupport`, and `@BuildStep`-driven native
  image registration via `quarkus.atmosphere.*` properties. See
  [Quarkus Reference](/docs/integrations/quarkus/).
- **Kotlin DSL** — `atmosphere { ... }` builder and coroutine extensions
  (`broadcastSuspend`, `writeSuspend`). Requires Kotlin 2.1+.
- **`atmosphere-channels`** — bridges `@Agent` to Slack, Telegram, Discord,
  WhatsApp, and Messenger with zero per-channel code. `ChannelFilter` chain for
  message processing, plus built-in `MessageSplittingFilter` (auto-truncates to
  channel max length) and `AuditLoggingFilter`.

## MCP (Model Context Protocol)

- **MCP server** — expose tools, resources, and prompt templates to AI agents
  with `@McpTool` / `@McpResource` / `@McpPrompt` annotations on any class
  marked `@Agent` (there is no dedicated `@McpServer` annotation — the MCP
  module reuses `@Agent` from `atmosphere-agent`). Supports Streamable HTTP
  (MCP 2025-03-26 spec), WebSocket, or SSE, with a stdio bridge for Claude
  Desktop and a programmatic `McpRegistry` API. See
  [MCP Reference](/docs/reference/mcp/).
- **OpenTelemetry tracing** — `McpTracing` auto-instruments tool, resource, and
  prompt calls with span propagation.

## Client Libraries

- **atmosphere.js 5.0.22** — TypeScript client with no runtime dependencies.
  ESM + CJS + IIFE bundles, WebSocket with configurable fallback to SSE, HTTP
  streaming, or long-polling. See [atmosphere.js](/docs/clients/javascript/).
- **React, Vue, Svelte hooks** — `useAtmosphere`, `useRoom`, `usePresence`,
  `useStreaming` via `atmosphere.js/react`, `/vue`, and `/svelte`. Shared chat
  components via `atmosphere.js/chat`.
- **React Native / Expo** — `useAtmosphere` React Native hook with an
  `EventSource` polyfill, NetInfo injection, and markdown rendering for mobile
  AI chat. See [React Native](/docs/clients/react-native/).
- **wAsync 4.0** — the Java client rewritten on `java.net.http` with gRPC
  support. See [Java Client](/docs/clients/java/).

## Samples

Atmosphere 4.0 ships with a wide set of runnable samples covering every
major feature area — real-time chat, AI streaming with multiple providers,
tool calling, multi-agent orchestration, MCP, RAG, clustering, durable
sessions, and channel integrations. The full catalogue lives at
[`samples/` on GitHub](https://github.com/Atmosphere/atmosphere/tree/main/samples).
Highlights:

| Sample | Feature area |
|--------|--------------|
| `spring-boot-ai-chat` | Streaming AI chat via the `AgentRuntime` SPI (auto-selects provider) |
| `spring-boot-ai-tools` | Portable `@AiTool` tool calling across all runtimes |
| `spring-boot-ai-classroom` | Multi-room AI with a React Native / Expo client |
| `spring-boot-rag-chat` | Retrieval-augmented generation with `ContextProvider` |
| `spring-boot-mcp-server` | MCP server exposing tools, resources, and prompts |
| `spring-boot-a2a-agent` | A2A protocol agent-to-agent communication |
| `spring-boot-agui-chat` | AG-UI protocol with progressive UI streaming |
| `spring-boot-dentist-agent` | Dr. Molar emergency dental agent with Slack + Telegram channels |
| `spring-boot-multi-agent-startup-team` | `@Coordinator` multi-agent workflow |
| `spring-boot-checkpoint-agent` | Durable HITL workflow with `CheckpointStore` |
| `spring-boot-orchestration-demo` | Support desk with live handoff and `@RequiresApproval` |
| `spring-boot-durable-sessions` | Session persistence across restarts |
| `spring-boot-channels-chat` | Multi-channel (Slack/Telegram/Discord) chat |
| `spring-boot-koog-chat` | Koog runtime streaming chat |
| `spring-boot-otel-chat` | OpenTelemetry tracing with Jaeger |
| `quarkus-chat` | Quarkus extension chat |
| `grpc-chat` | Standalone gRPC transport |

## Developer Experience

- **Architectural validation** — CI gate detects NOOP/dead code, placeholder
  stubs, DI bypass, and fluent builder misuse via TOML-configured patterns.
- **`atmosphere-generator`** — CLI scaffolding with `--tools` flag to generate
  `@AiTool` methods.
- **24-chapter tutorial** — the full tutorial book at
  [Chapter 1: Introduction](/docs/tutorial/01-introduction/) walks from "install
  the CLI" through AI, MCP, clustering, and multi-channel deployment.

## Breaking Changes

Heads up before you upgrade:

- **Token → Streaming Text rename (4.0.11).** Every AI API, javadoc entry, and
  atmosphere.js client surface moved from "token" to "streaming text" to
  describe LLM output chunks. `onToken` → `onStreamingText`, `totalTokens` →
  `totalStreamingTexts`, and the wire protocol message type changed from
  `"token"` to `"streaming-text"`. This is a **breaking change** for
  atmosphere.js consumers and custom `AiStreamBroadcastFilter` implementations.
- **Jackson 3.1.1 migration.** The runtime now depends on Jackson 3.x, which
  moved its packages from `com.fasterxml.jackson` to `tools.jackson`. Custom
  `JacksonEncoder` / `JacksonDecoder` subclasses, any filters that construct
  `ObjectMapper` directly, and any integration code importing from
  `com.fasterxml.jackson.*` need to be updated.
- **`AiSupport` → `AgentRuntime`.** Code that implemented the legacy `AiSupport`
  SPI should migrate to `AgentRuntime`. The capability baseline, tool calling,
  and usage metadata contracts are now unified across all six runtimes.
- **WebSocket HTML sanitization (4.0.11).** HTML sanitization was disabled for
  the WebSocket transport because encoding JSON in WebSocket frames broke the
  AI streaming wire protocol. HTTP transports continue to sanitize write
  methods, and cookies over HTTPS now default to `Secure`.
- **JDK 21 minimum.** No Java 8/11/17, no `javax.servlet`, no legacy app
  servers (GlassFish 3/4, Jetty 6-11, Tomcat 6-10, WebLogic, JBoss AS 7, or
  Netty/Play/Vert.x integrations).
- **atmosphere.js package rename.** The npm package is `atmosphere.js` (no
  jQuery dependency). Update imports to
  `import { atmosphere } from 'atmosphere.js'`.

## See Also

- [Full CHANGELOG](https://github.com/Atmosphere/atmosphere/blob/main/CHANGELOG.md)
- [Tutorial — Chapter 1](/docs/tutorial/01-introduction/)
- [@Agent](/docs/agents/agent/) · [@Coordinator](/docs/agents/coordinator/) · [Skills](/docs/agents/skills/)
- [Spring Boot](/docs/integrations/spring-boot/) · [Quarkus](/docs/integrations/quarkus/)
- [WebTransport](/docs/reference/webtransport/) · [AI Testing](/docs/reference/testing/)
