---
title: "What's New in 4.0"
description: "Highlights from the Atmosphere 4.0.x release line"
---

# What's New in Atmosphere 4.0

Atmosphere 4.0 is the JDK 21+ rewrite of the framework. The 4.0.0 release shipped the
core platform migration (Jakarta EE 10, virtual threads, Jetty 12 / Tomcat 11, native
image support, rooms, AI streaming SPI, MCP, TypeScript client). Since then the 4.0.x
line has grown into a full multi-agent runtime — unified agent annotations, nine
pluggable AI runtimes, orchestration primitives, WebTransport/HTTP3, React Native
support, and major compatibility refreshes.

The latest build tracks **Spring Boot 4.0.6**, **Quarkus 3.35.2**,
**Jackson 3.1.1**, and **atmosphere.js 5.0.22**, and requires **JDK 21** as a minimum.

This page is a highlights reel. For the per-patch history, see the
[CHANGELOG](https://github.com/Atmosphere/atmosphere/blob/main/CHANGELOG.md).

## 4.0.43 — 2026-05-06

- **Cross-tab `@AiEndpoint` isolation fix** — `AiEndpointHandler.onRequest`
  now dispatches POST/frame prompts to the originating client only,
  routing via `SUSPENDED_ATMOSPHERE_RESOURCE_UUID` (WebSocket) or
  `X-Atmosphere-tracking-id` (SSE / long-polling). Pre-fix, the handler
  called `broadcaster.broadcast(msg)` on the per-path broadcaster, so two
  open Console tabs each received both prompts. Pinned by 15 Playwright
  cases driving real Chromium with two browser contexts (every AI-shaped
  sample with a Console UI), plus contract tests in
  `AiEndpointHandlerCrossTabIsolationTest`.
- **Bundled Atmosphere Console auto-detects `ai` vs. `broadcast` mode** —
  `/api/console/info` adds a `mode` field and the Vue frontend swaps
  empty-state copy + default subtitle. `@ManagedService` chats
  (`spring-boot-mcp-server`, `spring-boot-otel-chat`) now read "Multi-client
  broadcast chat" instead of borrowing the AI-assistant copy. Detection is
  class-name based (`org.atmosphere.{ai,agent,coordinator}.*` → ai,
  everything else → broadcast) so it stays compile-time independent of
  `modules/ai` and `modules/agent`.
- **Quarkus parity for `/api/console/info`** — new
  `AtmosphereConsoleInfoServlet` (registered via `registerConsoleInfoServlet`
  build step in `AtmosphereProcessor`) gives Quarkus apps the same
  `subtitle / endpoint / runtime / mode` payload Spring Boot apps get.
  Two new config keys — `quarkus.atmosphere.console-subtitle` and
  `quarkus.atmosphere.console-endpoint` — mirror the Spring side.

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
- **Nine runtimes** share a unified capability baseline (text streaming,
  structured output, progress events, conversation memory, per-request retry):
  **Built-in**, **LangChain4j**, **Spring AI**, **Google ADK**, **Embabel**,
  **JetBrains Koog**, **Microsoft Semantic Kernel**, **Alibaba AgentScope**,
  and **Spring AI Alibaba**. Tool calling reaches the seven runtimes whose
  underlying SDK exposes a native dispatch loop (AgentScope and Spring AI
  Alibaba lack one in the current SDK releases). The built-in runtime gained
  full OpenAI-compatible tool calling (max 5 rounds), so `@AiTool` works
  with zero framework dependencies.
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

## Governance & Compliance

Introduced in **4.0.40**. A declarative layer over the guardrail SPI plus
the wire surfaces, samples, and CI gates that make it adoptable. See the
[governance reference](/docs/reference/governance/) for the full story.

### Policy plane

- **`GovernancePolicy` SPI** — admit / transform / deny vocabulary aligned
  with OPA/Rego and Microsoft Agent Governance Toolkit; stable identity
  (`name` / `source` / `version`) for audit-trail pinning.
- **YAML `PolicyParser` (default)** — drop `atmosphere-policies.yaml` on
  the classpath, restart, governance changes. Built-in types:
  `pii-redaction`, `cost-ceiling`, `output-length-zscore`, `deny-list`,
  `allow-list`, `message-length`, `rate-limit`, `concurrency-limit`,
  `time-window`, `metadata-presence`, `authorization`. SnakeYAML declared
  as an explicit runtime dep so bare-JVM and Quarkus deployments get the
  parser out-of-the-box.
- **Microsoft schema parity** — `YamlPolicyParser` auto-detects MS Agent
  Governance Toolkit YAML (top-level `rules:` sequence) and produces an
  `MsAgentOsPolicy` honoring all nine operators
  (`eq`/`ne`/`gt`/`lt`/`gte`/`lte`/`in`/`contains`/`matches`) and four
  actions (`allow`/`deny`/`audit`/`block`). Conformance tests load MS's
  own examples byte-for-byte.
- **Optional plug-in parsers** — `atmosphere-ai-policy-rego` (OPA, shells
  to `opa eval`) and `atmosphere-ai-policy-cedar` (AWS, shells to
  `cedar authorize` or plugs in `cedar-java`).

### Goal-hijacking prevention

- **`@AgentScope` annotation** — declarative purpose + forbidden topics
  per `@AiEndpoint`. Three tiers: rule-based (sub-ms, ships with built-in
  hijacking probes for code / medical / legal / financial),
  embedding-similarity (default), and LLM-classifier (opt-in for
  high-stakes scopes). Breach behavior: `POLITE_REDIRECT` /
  `DENY` / `CUSTOM_MESSAGE`.
- **System-prompt hardening** — `AiPipeline` prepends an unbypassable
  scope-confinement preamble to every `execute()` call so a sample
  author can't accidentally drop it.
- **Sample-hygiene CI lint** — `SampleAgentScopeLintTest` walks
  `samples/` and fails the build on any `@AiEndpoint` or `@Coordinator`
  missing `@AgentScope` (or lacking a non-blank `justification` when
  `unrestricted = true`). 12 existing endpoints retrofitted.
- **`ScopePolicy.postResponseCheck`** — re-classify the streamed
  response against the declared purpose; OUT_OF_SCOPE responses become
  Deny with a `post-response:` prefix.
- **Per-request scope install** — interceptors can write a `ScopeConfig`
  for a single turn (one `@AiEndpoint` hosts four classroom personas,
  each with its own scope).

### Tool-call admission

- **`PolicyAdmissionGate.admitToolCall`** — `ToolExecutionHelper`
  consults the gate on every `@AiTool` dispatch. The canonical MS rule
  `{field: tool_name, operator: eq, value: drop_database, action: deny}`
  fires before the executor runs. OWASP A02 (Tool Misuse): COVERED.

### Plan-and-verify (`atmosphere-verifier`)

- **Static verification of LLM-emitted tool-call workflows** — the LLM
  emits a JSON workflow describing the entire intended sequence; a
  deterministic verifier chain runs over the AST against a declarative
  `Policy`; only verified plans dispatch. Atmosphere's implementation
  of [Erik Meijer's *Guardians of the Agents* pattern (CACM, January
  2026)](https://cacm.acm.org/research/guardians-of-the-agents/),
  modelled on the [metareflection/guardians](https://github.com/metareflection/guardians)
  Python reference implementation.
- **Six built-in verifiers** auto-discovered via `ServiceLoader`:
  `AllowlistVerifier` (priority 10) catches deployment drift between
  policy and registry; `WellFormednessVerifier` (20) blocks forward
  binding references; `CapabilityVerifier` (25) enforces least-authority
  via `@RequiresCapability` grants; `TaintVerifier` (30) refuses
  dataflow into `@Sink`-marked parameters incl. transitive flow;
  `AutomatonVerifier` (40) executes plans against `SecurityAutomaton`
  sequences; `SmtVerifier` (200) wraps the `SmtChecker` SPI for Z3-style
  proof checks (no-op default ships in-tree).
- **Co-located policy** — `@Sink(forbidden = {"fetch_emails"})` on a
  tool parameter is the entire dataflow declaration; `SinkScanner`
  derives the `TaintRule` at startup. Renaming a tool or parameter
  without updating both ends is impossible because the rule travels
  with the code.
- **`PlanAndVerify` orchestrator** runs the runtime in plan mode (empty
  tool list, LLM emits JSON), parses via `WorkflowJsonParser`, runs the
  verifier chain via `VerificationResult.merge`, and dispatches via
  `WorkflowExecutor` only on green. Refusal throws
  `PlanVerificationException` carrying the offending workflow plus the
  full violation list — and crucially, no tool fires on that path.
- **`verify` CLI** — offline plan inspection against any policy JSON,
  exits 0/1/2 for shell pipelines and CI corpora.
- **Sample**: `spring-boot-guarded-email-agent` runs the canonical
  inbox-exfiltration scenario end-to-end; the malicious goal is refused
  with a typed taint violation on `steps[1].arguments.body`. Spring
  Boot test + 6 Playwright e2e tests pin the headline guarantee.

### Cross-runtime-adapter contract

- **`AbstractAgentRuntimeContractTest.policyDenyBlocksRuntimeExecute`**
  is inherited by all nine runtime adapters (Built-in, Spring AI,
  LangChain4j, ADK, Embabel, Koog, Semantic Kernel, AgentScope,
  Spring AI Alibaba). The "deny before runtime" guarantee is a
  build-time invariant for each runtime adapter; a regression breaks the
  build, not production.

### Commitment records

- **Ed25519-signed commitment records** (`@Experimental`) — extend W3C
  Verifiable Credentials + Google AP2 delegated-authority semantics to
  cross-agent dispatch logs. Emitted from `JournalingAgentFleet` when a
  signer is installed.
- **Flag-off by default** — `atmosphere.ai.governance.commitment-records.enabled=false`.
  Schema is subject to revision while the W3C CCG / AP2 / Visa TAP
  standards-track convergence settles; opt-in operators acknowledge
  potential migration.

### Compliance evidence

- **Self-assessment matrices** — OWASP Agentic Top 10 (Dec 2025) plus
  EU AI Act / HIPAA / SOC2 mappings live in `OwaspAgenticMatrix` and
  `ComplianceMatrix`. Each row carries evidence class, test class, and
  a consumer-grep pattern.
- **`EvidenceConsumerGrepPinTest`** — walks `src/main` under modules +
  samples and fails the build if any row claims coverage with no
  production consumer. No marketing-grade overclaim survives a CI run.
- **`agt verify`-shaped JSON export** at
  `GET /api/admin/governance/agt-verify` — wire-compatible with Microsoft
  Agent Compliance so cross-vendor compliance pipelines round-trip both.

### Audit trail + persistent sinks

- **`GovernanceDecisionLog`** — thread-safe ring buffer (default 500
  entries) with redaction-safe context snapshots (truncated message,
  primitive-only metadata). Surfaced at
  `GET /api/admin/governance/decisions`.
- **`AuditSink` SPI + `AsyncAuditSink`** — bounded drop-on-full queue so
  the admission thread never blocks on IO. Two reference modules ship:
  `atmosphere-ai-audit-kafka` and `atmosphere-ai-audit-postgres` (JSONB
  on Postgres, CLOB elsewhere; works against any `DataSource`). JSON
  shape matches MS Agent Governance Toolkit's `audit_entry`.

### Admin surfaces

- **12 governance endpoints** under `/api/admin/governance/` — read
  endpoints (`policies`, `summary`, `health`, `decisions`, `owasp`,
  `compliance`, `agt-verify`, `commitments`) and write endpoints
  (`check`, `reload`, `kill-switch/{arm,disarm}`).
- **Triple-gate authorization** — feature flag → Principal →
  `ControlAuthorizer`. Spring Boot and Quarkus ship symmetric
  implementations; Quarkus adds a fourth principal source
  (constant-time-compared `X-Atmosphere-Auth` token) for ops tooling
  not yet on Jakarta Security.
- **Admin Console tabs** — three Vue views (Policies, Decisions, OWASP)
  poll the read endpoints on live intervals; tabs auto-hide when
  governance is not installed.

### Sample

- **`spring-boot-ms-governance-chat`** — chat gated by Microsoft Agent
  Governance Toolkit YAML, verbatim. Demonstrates 9 MS-schema rules
  (destructive SQL, legal/media/exec escalation, PII shapes, password
  disclosure, discount-limit enforcement) plus `@AgentScope` for
  customer-support confinement.

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
- **Governance policy plane** — declarative `GovernancePolicy` SPI layered on
  top of `AiGuardrail`. `YamlPolicyParser` loads Atmosphere-native
  (`policies:` / `type:`) or **Microsoft Agent Governance Toolkit**
  (`rules:` / `condition:`) YAML verbatim — all nine MS operators and four
  actions ported faithfully, conformance pinned against MS's own example
  YAMLs. `PolicyAdmissionGate` extends governance to non-pipeline code
  paths; `GovernanceController` exposes `/api/admin/governance/policies`,
  `/summary`, and a Microsoft-`/check`-compatible decision endpoint so
  external gateways (Envoy, Kong, Azure APIM) can point at Atmosphere as
  their policy provider without code changes. See
  [Governance Policy Plane tutorial](/docs/tutorial/30-governance-policy-plane/)
  and [reference](/docs/reference/governance/).

## Integrations

- **Spring Boot 4.0.6** — auto-configuration, Actuator
  health indicator (`AtmosphereHealthIndicator`), and GraalVM AOT runtime hints
  (`AtmosphereRuntimeHints`). Spring Boot 4.0 is modularized, so the starter now
  depends explicitly on `spring-boot-servlet`, `spring-boot-web-server`, and
  `spring-boot-health` where needed. The starter overrides the parent POM's old
  SLF4J 1.x/Logback 1.2.x pins in `<dependencies>` so upgrades don't regress.
  See [Spring Boot Reference](/docs/integrations/spring-boot/).
- **Quarkus 3.35.2** — build-time Jandex annotation scanning, Arc CDI
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
  (MCP 2025-11-25 spec), WebSocket, or SSE, with a stdio bridge for Claude
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
major feature area — real-time chat, AI streaming with multiple runtime adapters,
tool calling, multi-agent orchestration, MCP, RAG, clustering, durable
sessions, and channel integrations. The full catalogue lives at
[`samples/` on GitHub](https://github.com/Atmosphere/atmosphere/tree/main/samples).
Highlights:

| Sample | Feature area |
|--------|--------------|
| `spring-boot-ai-chat` | Streaming AI chat via the `AgentRuntime` SPI (auto-selects runtime adapter) |
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
| `spring-boot-channels-chat` | Multi-channel (Slack/Telegram/Discord/WhatsApp/Messenger) chat |
| `spring-boot-otel-chat` | OpenTelemetry tracing with Jaeger |
| `spring-boot-ms-governance-chat` | Microsoft Agent Governance Toolkit demo with `@AgentScope` policy chain |
| `spring-boot-coding-agent` | Sandboxed coding agent — clones a repo, reads files, proposes a patch |
| `spring-boot-guarded-email-agent` | Plan-and-Verify (`atmosphere-verifier`) inbox-exfiltration demo |
| `spring-boot-personal-assistant` | Long-lived `@Coordinator` assistant with memory + delegation |
| `spring-boot-reattach-harness` | Mid-stream reattach harness (`@AiEndpoint` reattach contract) |
| `quarkus-chat` | Quarkus extension chat |
| `quarkus-ai-chat` | Five `@AiEndpoint` demos on Quarkus + LangChain4j bridge (port 18810) |
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
  and usage metadata contracts are now unified across all nine runtimes.
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
