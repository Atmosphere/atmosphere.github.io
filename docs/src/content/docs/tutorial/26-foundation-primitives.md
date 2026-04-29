---
title: "Foundation Primitives Tour"
description: "A one-page tour of the eight primitives every AI agent built on Atmosphere gets for free — what each does, where it's wired, and the sample line that exercises it"
---

# Foundation Primitives Tour

Atmosphere ships eight primitives that every AI agent gets for free —
state, workspace, protocol bridging, gateway admission, identity +
permissions, per-user tool extension, sandboxed execution, and
resumable runs. This page is the map: one paragraph per primitive,
the framework file that consumes it, and the sample line you can
copy.

Framework-scoped resolution is the thread that ties them all together
— every primitive resolves through
`framework.getAtmosphereConfig().properties()` first, then
`ServiceLoader`, then a safe default. The same pattern
`BroadcasterFactory` and `AsyncSupport` use.

## 1. AgentState / FileSystemAgentState

Durable per-agent state between restarts. A cheap key/value store
rooted at a per-agent directory; the built-in `FileSystemAgentState`
impl is zero-dep.

- **Consumer** — `AgentProcessor.buildFoundationPrimitives`
  (`modules/agent`) creates one per `@Agent` and publishes it into the
  injectables map.
- **Usage** — declare `AgentState state` as a parameter on any
  `@Prompt` or `@AiTool` method.
- **Sample** — `samples/spring-boot-personal-assistant/…/PrimaryAssistant.java`

## 2. AgentWorkspace

Agent-as-artifact SPI. Adapters parse a directory on disk into an
`AgentDefinition` (identity / persona / user profile / operating rules
/ skills / composed system prompt). In-tree today:

- `OpenClawWorkspaceAdapter` — canonical OpenClaw layout (`AGENTS.md`
  + `SOUL.md` + `USER.md` + `IDENTITY.md` + `MEMORY.md` + `skills/`)
  plus Atmosphere-only extension files (`CHANNELS.md`, `MCP.md`,
  `RUNTIME.md`, `PERMISSIONS.md`, `SKILLS.md`) that OpenClaw ignores.
- `AtmosphereNativeWorkspaceAdapter` — fallback that accepts any
  directory, reading `README.md` as operating rules when present.

Third-party adapters ship via `META-INF/services/`. The SPI surface
is `supports(Path)` / `load(Path)` / `name()` / `priority()`; the
adapter does not directly expose read/write APIs — writes go through
`FileSystemAgentState`.

- **Consumer** — `AgentProcessor.buildFoundationPrimitives` picks the
  highest-priority adapter whose `supports()` accepts the workspace
  root, via `AgentWorkspaceLoader` (ServiceLoader).
- **Sample** — personal-assistant ships a classpath-rooted workspace
  at `src/main/resources/agent-workspace/` that the adapter loads at
  startup.

## 3. ProtocolBridge

Plug any wire protocol (A2A, AG-UI, MCP, custom) into an agent via
`ProtocolBridge` impls. Four are in-tree today:
`A2aProtocolBridge`, `AgUiProtocolBridge`, `McpProtocolBridge`,
`InMemoryProtocolBridge`. Bridges are discovered at startup and each
surfaces its own sub-path on the registered agent.

- **Consumer** — `AgentProcessor` walks all `ProtocolBridge`
  implementations on the classpath and binds each to the agent.
- **Log line** — `Agent 'X' registered at /atmosphere/agent/X (..., protocols: [a2a, mcp])`
  reflects runtime-resolved state, never configuration intent.

## 4. AiGateway

The choke-point every outbound LLM call crosses — per-user rate
limiter, credential resolver, and trace exporter. Process-wide
installed via `AiGatewayHolder.install(...)`; every
`*AgentRuntime.doExecute` / `doExecuteWithHandle` calls
`admitThroughGateway(context)` before native dispatch.

- **Consumer** — all seven runtimes: `BuiltInAgentRuntime.java:79,98`,
  `SpringAiAgentRuntime.java:104`, `LangChain4jAgentRuntime.java:147`,
  `AdkAgentRuntime.java:292`, `SemanticKernelAgentRuntime.java:118`,
  `EmbabelAgentRuntime.kt:110`, `KoogAgentRuntime.kt:103,165`.
- **Sample** — every sample implicitly exercises it; nothing dispatches
  an LLM without admission.

## 5. AgentIdentity + PermissionMode

Per-user identity, credentials, and session-scoped
`PermissionMode` (`DEFAULT` / `PLAN` / `ACCEPT_EDITS` / `BYPASS` /
`DENY_ALL`). The outer gate `ToolExecutionHelper` consults before
`@RequiresApproval` fires.

- **Consumer** — `ToolExecutionHelper.resolveMode` +
  `identity.permissionMode(userId)` on every tool call.
- **Walkthrough** — the
  [three-phase trust tutorial](./25-trust-phases) narrates the PLAN →
  DEFAULT → BYPASS adoption pattern.

## 6. ToolExtensibilityPoint

Per-user MCP-server attachment. Lets a user ship their own set of
tools to an agent without the agent owner having to redeploy — shaped
as a classpath SPI plus a credential store hook.

- **Consumer** — personal-assistant's `PrimaryAssistant`,
  `ResearchAgent`, `SchedulerAgent` — each pulls per-user MCP tools via
  `ToolExtensibilityPoint` + per-user credentials from
  `AgentIdentity.CredentialStore`.

## 7. Sandbox

Isolated execution for agent-generated code. `SandboxProvider` factory,
`Sandbox` handle (try-with-resources), `SandboxLimits`,
`NetworkPolicy`. Docker impl is the production default; an opt-in
in-process reference impl exists for dev.

- **Consumer** — `samples/spring-boot-coding-agent/…/CodingAgent.java`
  clones a repo, reads a file, and proposes a patch — exercising every
  surface: `exec`, `readFile`, argv-form safety, strict URL allowlist.
- **Details** — see [`modules/sandbox/README.md`](https://github.com/Atmosphere/atmosphere/blob/main/modules/sandbox/README.md).

## 8. AgentResumeHandle / RunRegistry

Survivable agent runs. Every `@Prompt` invocation registers with the
process-wide `RunRegistry` and receives a stable `runId`. Clients that
reconnect carry `X-Atmosphere-Run-Id` — `AiEndpointHandler` consults
the registry, drains the replay buffer, and streams the missed events
back to the new resource.

- **Producer** — `AiEndpointHandler.invokePrompt` at the RunRegistry
  register call.
- **Consumer** — `AiEndpointHandler.reattachPendingRun` on reconnection.
- **Storage** — in-memory registry with configurable TTL sweeper.

## Where each primitive is wired

The primitives compose through `AgentProcessor` and
`CoordinatorProcessor`:

```
HTTP request ─► AiEndpointHandler ─► AiStreamingSession ─► AgentRuntime
                      │                      │
                      │                      ├── AiGateway.admit(...)
                      │                      ├── ToolExecutionHelper
                      │                      │     ├── AgentIdentity.permissionMode(userId)
                      │                      │     ├── @RequiresApproval gate
                      │                      │     └── injectables: AgentState, AgentWorkspace, Sandbox, ...
                      │                      └── Guardrails (PII / drift / custom)
                      │
                      ├── FactResolver.resolve(...) → systemPrompt prepend
                      ├── BusinessMetadata → MDC for log correlation
                      └── RunRegistry.register(...) → X-Atmosphere-Run-Id
```

## Related reading

- [Earning Trust: the Three-Phase Adoption Pattern](./25-trust-phases)
  — PermissionMode + @RequiresApproval + guardrails in a supervised →
  autonomous ramp.
- [Durable HITL Workflows](./24-durable-hitl) — @RequiresApproval that
  survives a process restart.
- [AI Adapters](./11-ai-adapters) — the seven `AgentRuntime`
  implementations and their capability matrix.
