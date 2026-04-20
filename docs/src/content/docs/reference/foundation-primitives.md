---
title: Foundation Primitives
description: The eight runtime-agnostic primitives every Java AI agent needs, introduced in Atmosphere 2.x
---

Atmosphere 2.x ships eight foundation primitives — named nouns every Java
AI agent needs, regardless of what the agent does, working across all
seven hosted runtimes (Built-in · Spring AI · LangChain4j · Google ADK ·
Koog · Semantic Kernel · Embabel).

The governing analogy is Atmosphere 1.0. 1.0 didn't build a chat app; it
built `AtmosphereResource`, `Broadcaster`, `CometSupport`, and the rest —
nouns every real-time Java app needed. Atmosphere 2.x does the same for AI
agents.

## The eight primitives

### `AgentState`

Package: `org.atmosphere.ai.state`

Unified SPI for conversation history, durable facts, daily notes, working
memory, and hierarchical rules. File-backed default reads and writes an
OpenClaw-compatible Markdown workspace. `AutoMemoryStrategy` is pluggable;
four built-ins (`EveryNTurns`, `LlmDecided`, `SessionEnd`, `Hybrid`)
cover the common patterns.

Isolation by design: every read and every write is scoped by
`(userId, agentId)` so facts never bleed across users or agents.

### `AgentWorkspace`

Package: `org.atmosphere.ai.workspace`

Agent-as-artifact. Adapters parse a directory into an `AgentDefinition`.
`OpenClawWorkspaceAdapter` reads the canonical OpenClaw layout plus
Atmosphere extension files (`CHANNELS.md`, `MCP.md`, `RUNTIME.md`,
`PERMISSIONS.md`, `SKILLS.md`) that OpenClaw itself ignores. A native
fallback accepts any directory.

### `ProtocolBridge`

Package: `org.atmosphere.ai.bridge`

Inbound facade for how agents are reached. `InMemoryProtocolBridge` puts
in-JVM dispatch on equal footing with wire bridges (MCP, A2A, AG-UI,
gRPC) — the Atmosphere 1.0 Broadcaster pattern applied to agent
dispatch.

### `AiGateway`

Package: `org.atmosphere.ai.gateway`

Outbound facade for every LLM call. One admission point for per-user
rate limiting, per-user credential resolution, and unified trace
emission. Plugs pluggable `CredentialResolver` and
`GatewayTraceExporter` with `noop()` defaults for embedded setups.

### `AgentIdentity`

Package: `org.atmosphere.ai.identity`

Per-user identity, permissions, credentials, audit trail, session
sharing. `PermissionMode` (`DEFAULT` / `PLAN` / `ACCEPT_EDITS` /
`BYPASS` / `DENY_ALL`) layers over per-tool `@RequiresApproval`.
`CredentialStore` pluggable; the `AtmosphereEncryptedCredentialStore`
default uses AES-GCM with a 256-bit key and per-entry random IV,
fail-closed on tampered ciphertext.

### `ToolExtensibilityPoint`

Package: `org.atmosphere.ai.extensibility`

How agents acquire new capabilities at runtime. `ToolIndex` scores
descriptors by token-overlap; `DynamicToolSelector` enforces
`maxToolsPerRequest` so agents with many tools don't inject every
descriptor into every prompt. `McpTrustProvider` resolves per-user MCP
credentials through the user's `CredentialStore`.

### `Sandbox`

Package: `org.atmosphere.ai.sandbox`

Pluggable isolated execution for untrusted code and commands. Docker is
the production default; an in-process reference backend ships for
development (explicitly not a security boundary). `@SandboxTool` binds
tool methods to a sandbox backend; there is no silent fallback when the
requested backend is unavailable.

Default limits: 1 CPU · 512 MB · 5 min wall-clock · no network.

### `AgentResumeHandle`

Package: `org.atmosphere.ai.resume`

Run ID + registry + bounded event replay buffer for mid-stream reconnect.
Closes the gap where `DurableSessionInterceptor` reattached rooms and
broadcasters on reconnect but not in-flight agent runs.

## Two proof samples

- [`samples/spring-boot-personal-assistant`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-personal-assistant)
  exercises `AgentState`, `AgentWorkspace`, `AgentIdentity`,
  `ToolExtensibilityPoint`, `AiGateway`, and `ProtocolBridge`.
- [`samples/spring-boot-coding-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-coding-agent)
  exercises `Sandbox` and `AgentResumeHandle`.

## Definition of "shipped" vs "complete"

- **Shipped**: SPI + default implementation + unit tests + zero-warning
  compile. All eight primitives are shipped in the current branch.
- **Complete**: shipped + wired into live paths + cross-runtime contract
  tests green on all seven runtimes + security invariants verified.

The completion bar is raised by three follow-up phases: gateway wire-in,
cross-runtime contract test matrix, and security default hardening.
