---
title: "Harness"
description: "The deep-agent harness — default-on memory, prompt caching, delegation, planning, and workspace files for @Agent, @Coordinator, and @AiEndpoint"
---

<!--
  Copyright 2008-2026 Async-IO.org

  Licensed under the Apache License, Version 2.0 (the "License"); you may not
  use this file except in compliance with the License. You may obtain a copy of
  the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
  WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
  License for the specific language governing permissions and limitations under
  the License.
-->

## Overview

Atmosphere agents are **deep agents out of the box**. The harness *completes* an agent: on top of whatever endpoint or agent you already have, it adds conversation memory, long-term memory (with a compaction seam), a prompt-cache default, the fleet delegation primitive, a persistent plan surface, and a bounded conversation-scoped file workspace — and reports each primitive's *actual* runtime state (never configuration intent) at `/api/console/info`.

The engine is `org.atmosphere.ai.preset.HarnessPreset`, driven by one granular attribute — `harness()` on [`@Agent`](/docs/agents/agent/), [`@Coordinator`](/docs/agents/coordinator/), and [`@AiEndpoint`](/docs/tutorial/09-ai-endpoint/) — typed by the `org.atmosphere.ai.preset.Harness` enum.

## The `Harness` Enum

| Value | What it turns on |
|-------|------------------|
| `Harness.MEMORY` | Conversation memory, the auto-attached long-term-memory interceptor, and the compaction seam on the resolved memory. |
| `Harness.CACHE` | Prompt-cache default seeding — endpoints whose annotation keeps `promptCache = NONE` are seeded with a `CONSERVATIVE` policy. |
| `Harness.DELEGATION` | The fleet delegation primitive — on a `@Coordinator`, the built-in `delegate_task` tool (route to a pre-declared fleet member) **and** the `task` tool (spawn an ephemeral, isolated general-purpose sub-agent on demand), plus the governance wrap on the outbound dispatch edge. |
| `Harness.PLANNING` | The planning primitive — the agent maintains a plan it exposes and updates: the built-in `write_todos` tool floor (or a native plan surface when the resolved runtime advertises `AiCapability.PLANNING` under the `atmosphere.ai.planning` AUTO default), persisted per conversation and streamed as `plan-update` events. |
| `Harness.FILESYSTEM` | The virtual-filesystem primitive — a bounded, conversation-scoped file store under the agent workspace: the built-in `ls` / `read_file` / `write_file` / `edit_file` / `glob` / `grep` tool floor (or a native file surface when the resolved runtime advertises `AiCapability.VIRTUAL_FILESYSTEM` under the `atmosphere.ai.filesystem` AUTO default). |
| `Harness.ALL` | Sentinel that expands to `{MEMORY, CACHE, DELEGATION, PLANNING, FILESYSTEM}` — the full harness. |

## Annotation Defaults

| Annotation | `harness()` default | Meaning |
|------------|--------------------|---------|
| `@Agent` | `{Harness.ALL}` | Batteries-included — a plain `@Agent` gets the full harness with no attribute at all. |
| `@Coordinator` | `{Harness.ALL}` | Same batteries-included default as the `@Agent` it subsumes — a declared fleet almost always wants the `delegate_task` tool and the governed dispatch edge. |
| `@AiEndpoint` | `{}` | Bare by default — each endpoint opts in explicitly. |

An **empty array is an opt-down to a bare loop**: `harness = {}` removes every harness feature from that agent or endpoint.

### Default-on (`@Agent`, `@Coordinator`)

```java
@Agent(name = "support-agent")
public class SupportAgent {
    // full harness: conversation + long-term memory, conservative
    // prompt-cache default — no attribute needed
    @Prompt
    public void onPrompt(String message, StreamingSession session) { /* ... */ }
}
```

**Headless agents are outside the harness**: an agent with protocol skill
handlers but no `@Prompt` method (or `headless = true`) has no prompt loop
for the harness to complete, so `harness()` does not apply there — the boot
logs an INFO saying so.

### Opt-down to a bare loop

```java
@Agent(name = "stateless-webhook", harness = {})
public class StatelessWebhookAgent {
    // bare loop: no memory, no cache seeding, no delegation
}
```

### Granular selection

```java
@Agent(name = "memo", harness = {Harness.MEMORY})
public class MemoAgent {
    // memory only — skips prompt-cache seeding and delegation
}
```

### Per-endpoint opt-in (`@AiEndpoint`)

```java
@AiEndpoint(path = "/atmosphere/assistant", harness = {Harness.ALL})
public class Assistant {
    // a plain endpoint that gains conversation + long-term memory
    // and the prompt-cache default with no per-class wiring
}
```

### Coordinator

```java
@Coordinator(name = "ceo", skillFile = "prompts/ceo-skill.md")
@Fleet({ @AgentRef(type = ResearchAgent.class) })
public class CeoCoordinator {
    // delegation is on by default: the built-in delegate_task and task
    // tools are registered and fleet dispatches run through the installed
    // governance policies
}
```

### Two delegation tools: `delegate_task` and `task`

On a `@Coordinator`, `DELEGATION` registers **two** built-in tools:

- **`delegate_task`** routes a subtask to a **pre-declared** fleet member — the specialists you named in `@Fleet`.
- **`task`** spawns an **ephemeral, general-purpose** sub-agent on demand (`SpawnSubagentTool`) — the dynamic counterpart, and the parity primitive for LangChain deepagents' `task` tool. Each spawn gets a fresh conversation id, its own plan store, and its own bounded file workspace under a per-spawn temporary root, so the sub-agent's `write_todos` and file tools never touch the parent's. Only the sub-agent's final text report crosses back; the workspace is removed on every exit path.

`task` is governed the same way the fleet edge is — the subtask prompt is evaluated against the installed governance policies (pre-admission, fail-closed) before any dispatch — and it is depth-bounded, spawn-count-bounded, and time-bounded so recursion cannot run away. A sub-agent already at maximum depth is not given the `task` tool.

## What Each Feature Attaches

| Primitive | Feature | What the harness does |
|-----------|---------|----------------------|
| Conversation memory | `MEMORY` | Multi-turn history is resolved even when the annotation's `conversationMemory` is `false` (`maxHistoryMessages` is still honored). An annotation value of `true` always wins — the harness never turns memory *off*. |
| Long-term memory | `MEMORY` | Appends a framework-built `LongTermMemoryInterceptor` *after* the user's interceptors: facts are extracted at session close and recalled on the next connection. A user-declared `LongTermMemoryInterceptor` is authoritative and suppresses the harness's. Store resolution: a container-bridged `LongTermMemory` → the highest-priority `ServiceLoader` `LongTermMemoryProvider` → the zero-dep `InMemoryLongTermMemory` fallback. |
| Compaction | `MEMORY` | The conversation-memory compaction seam — sliding-window by default; the harness never forces summarizing. |
| Prompt-cache default | `CACHE` | Endpoints whose annotation keeps `promptCache = NONE` are seeded with a `CONSERVATIVE` `CacheHint` policy, unless the independent `org.atmosphere.ai.prompt-cache.default` init-param overrides it (an explicit `none` there suppresses the seeding). Wire emission stays gated by the `atmosphere.ai.prompt-cache-key` mode and its default-deny host allow-list. |
| Delegation | `DELEGATION` | On a `@Coordinator`: registers the built-in `delegate_task` tool (route to a pre-declared fleet member) **and** the `task` tool (spawn an ephemeral general-purpose sub-agent with an isolated context and workspace), and wraps the fleet's outbound dispatch edge with the installed governance policies. A plain `@Agent` or `@AiEndpoint` has no fleet, so the primitive reports `INACTIVE(no-coordinator)` until a coordinator registers. |
| Planning | `PLANNING` | Binds an `AgentPlanStore` into the endpoint's injectables, then picks *one* plan surface by `atmosphere.ai.planning` mode: the runtime's native plan machinery when it declares `AiCapability.PLANNING`, else the built-in `write_todos` tool. Never both — no duplicate plan tools. A user-registered `write_todos` tool wins over the floor. |
| Virtual filesystem | `FILESYSTEM` | Binds an `AgentFileSystemProvider` into the endpoint's injectables, then picks *one* file surface by `atmosphere.ai.filesystem` mode: the runtime's native file machinery when it declares `AiCapability.VIRTUAL_FILESYSTEM`, else the built-in six-tool floor (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`). Never both — no duplicate file tools. User-registered tools with the same names win over the floor. |

## Planning & Workspace Files

`PLANNING` and `FILESYSTEM` give every tool-calling agent a **plan it maintains** and a **bounded scratch filesystem** — the deepagents-style working surface — with zero extra dependencies. Because `@Agent` and `@Coordinator` default to `{Harness.ALL}`, a plain annotation gets both out of the box: one `write_todos` tool plus six file tools, seven built-in harness tools in total.

### The built-in tool floor

| Tool | Does |
|------|------|
| `write_todos` | Creates or replaces the agent's **full** todo list (`{content, status, activeForm}` items; statuses `pending`, `in_progress`, `completed`, `abandoned`, plus an optional one-line `goal`). Persists per conversation, emits a `plan-update` streaming event on every change, and returns the plan as a Markdown checklist so the model sees the state it just wrote. |
| `ls` | Lists the entries directly under a workspace directory — directories first, then files. |
| `read_file` | Reads one workspace file's UTF-8 content. |
| `write_file` | Creates or overwrites a workspace file. |
| `edit_file` | Exact string replacement inside a workspace file. |
| `glob` | Matches workspace paths against a glob pattern. |
| `grep` | Regex search across workspace files, capped at 500 hits. |

### Storage layout

Plans and files persist on disk under the agent workspace root — the `atmosphere.workspace.root` system property, falling back to the `ATMOSPHERE_WORKSPACE_ROOT` environment variable, then to `{user.home}/.atmosphere/workspace`:

```
{workspace-root}/
  {agents|coordinators|endpoints}/{owner}/
    plans/{agentId}/{conversationId}.json    ← write_todos plans
    files/{conversationId}/                  ← the virtual filesystem
```

The file store is **conversation-scoped**: each session gets its own `files/{conversationId}/` subtree, so agents never see each other's (or another conversation's) files. Every model-supplied path is validated at the boundary — absolute paths, backslashes, `.`/`..` segments are rejected, and the resolved path is containment-checked against the root.

### Bounds

The store enforces hard limits on every write, with clear rejection messages surfaced to the model instead of stack traces:

| Bound | Default |
|-------|---------|
| Per-file size | 512 KiB |
| File count per store | 256 files |
| Total bytes per store | 16 MiB |
| `grep` output | 500 hits |

### Tool-output offload

A tool that returns a very large result would flood the model's context window. The harness offloads it to disk instead: when a tool result exceeds a threshold (**8000 characters** by default) **and** a filesystem surface is in scope, the full result is written to a `tool-output/{tool}-{id}.txt` file in the agent workspace and the model receives a truncated **preview** plus a pointer to `read_file` the saved file if it needs the rest — the deepagents-style context-management move. It is **default-on** and threshold-gated:

| Control | System property | Env fallback | Default |
|---------|-----------------|--------------|---------|
| Offload threshold (chars) | `org.atmosphere.ai.toolOutputOffloadThreshold` | `LLM_TOOL_OUTPUT_OFFLOAD_THRESHOLD` | `8000` (a value `<= 0` disables offload) |

The offload never loses data and never throws: a disabled threshold, a below-threshold result, no filesystem in scope, or a write failure all fall back to returning the result inline.

### Mode knobs (built-in floor vs. native surface)

Two JVM-wide tri-state controls pick the surface per primitive. The system property wins over the environment variable; parsing is lenient and case-insensitive (an unrecognized value collapses to `AUTO`):

| Control | System property | Env fallback | Values |
|---------|-----------------|--------------|--------|
| Plan surface | `atmosphere.ai.planning` | `LLM_PLANNING` | `auto` (default), `builtin`, `native` |
| File surface | `atmosphere.ai.filesystem` | `LLM_FILESYSTEM` | `auto` (default), `builtin`, `native` |

- **`auto`** — native wins when the resolved runtime *declares* the matching capability (`AiCapability.PLANNING` / `AiCapability.VIRTUAL_FILESYSTEM` — themselves runtime-truth contracts); the built-in floor registers otherwise.
- **`builtin`** — always the built-in tool floor, even on a native-capable runtime.
- **`native`** — never the built-in floor; when the runtime does not declare the capability the primitive reports `INACTIVE(native-unavailable)` and no surface exists.

Native declarations today (each pinned by the runtime's contract test): **AgentScope** and **Spring AI Alibaba** declare `PLANNING`; **ADK** and **Anthropic** declare `VIRTUAL_FILESYSTEM`. **Embabel**'s native surfaces (GOAP plan observation, `FileTools`) each cover only one of its two dispatch paths, so they are explicit opt-ins (`atmosphere.ai.planning=native` / `atmosphere.ai.filesystem=native`) rather than declared capabilities — a declaration would suppress the portable floor on the path the native surface can't reach. All other runtimes get the built-in floors.

### Composite filesystem routing

By default the file store is a single bounded per-conversation workspace. For agents that need a **durable, shared** slice of the namespace alongside the ephemeral scratch space — deepagents-style composite backend routing — opt in with a comma-separated `prefix=dir` route list. `CompositeAgentFileSystem` then presents one flat namespace to the model but routes each call to the delegate backend whose prefix matches (longest, most-specific prefix wins; the prefix is a routing key, not stripped from the path):

| Control | System property | Env fallback | Default |
|---------|-----------------|--------------|---------|
| Composite routes | `org.atmosphere.ai.filesystem.routes` | `LLM_FILESYSTEM_ROUTES` | off (single per-conversation workspace) |

```
org.atmosphere.ai.filesystem.routes=memory/=/var/agent-memory,shared/=/var/agent-shared
```

With that set, reads and writes under `memory/` and `shared/` land in durable stores shared across conversations, while everything else stays in the bounded per-conversation workspace. Every routed backend is itself a bounded `WorkspaceAgentFileSystem`, so the per-file / count / total-byte limits and the traversal guards hold on every route — the composite never weakens a delegate's bounds, and a `rename` whose two ends route to different backends fails loud rather than silently losing data.

### The console Workspace tab and admin surface

The Atmosphere Console gains a **Workspace** tab that renders the live plan (from `plan-update` streaming events) alongside the persisted plan snapshot and a file browser for the conversation workspace. The tab appears once at least one plan or filesystem surface is browsable. It is backed by a read-only admin REST surface (Spring Boot starter) that resolves the *exact* store instances the attach engines registered — never a reconstructed twin:

| Endpoint | Returns |
|----------|---------|
| `GET /api/admin/workspace/owners` | The owners with an attached plan store and/or filesystem provider: `[{owner, plan, filesystem}]`. |
| `GET /api/admin/agents/{name}/plan?sessionId=` | The current plan for one agent × conversation, in the same wire shape as the `plan-update` event. |
| `GET /api/admin/agents/{name}/files?sessionId=&path=` | Directory listing of the conversation's workspace subtree. |
| `GET /api/admin/agents/{name}/files/content?sessionId=&path=` | One workspace file's UTF-8 content. |

The endpoints inherit the opt-in `atmosphere.admin.http-read-auth-required` token gate applied to the whole `/api/admin/*` space, answer `404` for owners without a genuinely attached surface, and reject traversal-shaped session ids or paths with `400`.

## The App-Wide Flag (Tri-State)

One flag refines the annotations across the whole app. It is **tri-state**:

| Flag value | `@Agent` / `@Coordinator` (default `{ALL}`) | `@AiEndpoint` (default `{}`) |
|------------|---------------------------------------------|------------------------------|
| unset (the default) | full harness | bare — opts in via `harness = {...}` |
| `true` | full harness | full harness even when the annotation stays empty |
| `false` (kill switch) | off | off |

Two precision points, both pinned by tests in the framework:

- `false` is the **operational / compliance kill switch**: harness features stay off everywhere, beating every annotation.
- Under `true`, an explicit `harness = {}` on `@Agent` or `@Coordinator` remains a deliberate per-class opt-down that the flag does **not** override (their annotation default is non-empty, so an empty array is always intentional). Only a *bare* `@AiEndpoint` is upgraded to the full harness.

The flag parses with Boolean semantics: an absent or blank value stays unset; any other present value only reads as `true` when it is literally `true` — everything else reads as the kill switch.

### Configuration Keys

| Runtime | Enabled flag | Exclude paths | Compaction | Prompt-cache default |
|---------|-------------|---------------|------------|---------------------|
| Spring Boot | `atmosphere.ai.harness.enabled` | `atmosphere.ai.harness.exclude-paths` | `atmosphere.ai.harness.compaction` | `atmosphere.ai.harness.prompt-cache-default` |
| Quarkus | `quarkus.atmosphere.ai.harness.enabled` | `quarkus.atmosphere.ai.harness.exclude-paths` | `quarkus.atmosphere.ai.harness.compaction` | `quarkus.atmosphere.ai.harness.prompt-cache-default` |
| Servlet init-param | `org.atmosphere.ai.harness.enabled` | `org.atmosphere.ai.harness.exclude-paths` | `org.atmosphere.ai.compaction` | `org.atmosphere.ai.prompt-cache.default` |

The Spring Boot and Quarkus keys bridge to the servlet init-params, which `HarnessPreset` reads once per framework. `compaction` takes `sliding-window` (the default) or `summarizing`; `prompt-cache-default` takes `none`, `conservative`, or `aggressive`. Both work independently of the enabled flag — they matter under the unset default too, where `@Agent` classes carry the full harness.

**Spring Boot** (`application.yml`):

```yaml
atmosphere:
  ai:
    harness:
      enabled: true
      exclude-paths:
        - /atmosphere/internal-webhook
      compaction: sliding-window
      prompt-cache-default: conservative
```

**Quarkus** (`application.properties` — the keys are build-time fixed):

```properties
quarkus.atmosphere.ai.harness.enabled=true
quarkus.atmosphere.ai.harness.exclude-paths=/atmosphere/internal-webhook
quarkus.atmosphere.ai.harness.compaction=sliding-window
quarkus.atmosphere.ai.harness.prompt-cache-default=conservative
```

**Servlet** (`web.xml` init-params on the Atmosphere servlet):

```xml
<init-param>
    <param-name>org.atmosphere.ai.harness.enabled</param-name>
    <param-value>true</param-value>
</init-param>
<init-param>
    <param-name>org.atmosphere.ai.harness.exclude-paths</param-name>
    <param-value>/atmosphere/internal-webhook</param-value>
</init-param>
```

## Precedence

Strongest first:

1. **Kill switch** — `enabled=false` yields the empty set everywhere, beating every annotation.
2. **Exclude paths** — an excluded path yields the empty set.
3. **The annotation's `harness()`** — any non-empty value (including `@Agent`'s and `@Coordinator`'s batteries-included `{ALL}` default) resolves via `Harness.ALL` expansion.
4. **App-wide `true`** — a bare `@AiEndpoint` gets the full harness; an empty `@Agent` / `@Coordinator` annotation is an explicit opt-down and stays bare.
5. **Off** — the unset default leaves an empty annotation bare.

## Exclude Paths

`exclude-paths` is a comma-separated list of **exact** endpoint paths the harness skips — it beats annotations (only the kill switch is stronger). Use it to carve individual endpoints out of an otherwise default-on app:

```yaml
atmosphere:
  ai:
    harness:
      exclude-paths: /atmosphere/internal-webhook,/atmosphere/metrics-feed
```

## Durable Runs Implication

An explicitly enabled harness also implies the durable-run journal spine:

- **Spring Boot** — `atmosphere.ai.harness.enabled=true` implies `atmosphere.durable-runs.enabled` when that property is unset. An explicit `atmosphere.durable-runs.enabled=false` always wins; the unset harness default and the kill switch imply nothing.
- **Quarkus** — same implication, with `quarkus.atmosphere.ai.harness.durable-runs=false` as the explicit opt-out (default `true`). It never blocks an explicit `quarkus.atmosphere.durable-runs.enabled=true`.

## Runtime Truth in the Console

The harness never advertises a primitive it did not actually activate. `HarnessPreset` publishes a live per-primitive state map that both the Spring Boot and Quarkus console info endpoints surface at `GET /api/console/info` under `harness` (the block is omitted entirely when the preset never ran):

```json
"harness": {
  "conversation-memory": "ACTIVE",
  "long-term-memory": "ACTIVE(org.atmosphere.ai.memory.InMemoryLongTermMemory)",
  "prompt-cache-default": "conservative",
  "compaction": "sliding-window",
  "delegation": "INACTIVE(no-coordinator)",
  "planning": "ACTIVE(builtin)",
  "filesystem": "ACTIVE(builtin)",
  "skills": "CONVENTION",
  "durable-runs": "CONTAINER-MANAGED"
}
```

| Key | States |
|-----|--------|
| `conversation-memory` | `ACTIVE` once an endpoint genuinely resolves memory; `INACTIVE(disabled)` under the kill switch or when nothing attached. |
| `long-term-memory` | `ACTIVE(<store class>)` once the interceptor is genuinely attached; `INACTIVE(no-endpoint)` / `INACTIVE(disabled)` otherwise. |
| `prompt-cache-default` | The effective policy — `none`, `conservative`, or `aggressive`. |
| `compaction` | The resolved strategy — `sliding-window` or `summarizing`. |
| `delegation` | `ACTIVE` once a `@Coordinator` registers `delegate_task`; `INACTIVE(no-coordinator)` / `INACTIVE(disabled)` otherwise. |
| `planning` | `ACTIVE(builtin)` once the `write_todos` floor genuinely registers; `ACTIVE(native:<runtime>)` when the resolved runtime's native plan surface wins; `INACTIVE(native-unavailable)` under `native` mode on a runtime without `PLANNING`; `INACTIVE(no-endpoint)` / `INACTIVE(disabled)` otherwise. |
| `filesystem` | `ACTIVE(builtin)` once all six file tools register (`ACTIVE(builtin,partial)` when user tools shadow some); `ACTIVE(native:<runtime>)` when the resolved runtime's native file surface wins; `INACTIVE(native-unavailable)` under `native` mode on a runtime without `VIRTUAL_FILESYSTEM`; `INACTIVE(no-endpoint)` / `INACTIVE(disabled)` otherwise. |
| `skills` | `CONVENTION` — skills stay per-agent convention-discovered (`META-INF/skills/`); there is no global switch. |
| `durable-runs` | `CONTAINER-MANAGED` — the journal spine is installed by the Spring / Quarkus bridge, not by the preset. |

States reflect what an endpoint *got*, not what was configured — a long-term-memory store only reads `ACTIVE(<class>)` once the interceptor is genuinely attached, and a feature absent from a path's resolved set stays `INACTIVE(disabled)`.

## Sample

The `spring-boot-personal-assistant` sample exercises the opt-in surface: its plain `@AiEndpoint` (`UpstreamMcpAgent`) opts in with `harness = {Harness.ALL}` and gains cross-session long-term memory with no per-class wiring. (Its `ResearchAgent` crew member is headless — skill handlers, no `@Prompt` — so the harness does not apply to it; the booted default-on truth for a prompt-loop `@Agent` is pinned by the Spring starter's `HarnessRuntimeTruthHttpE2eTest`.)

## See Also

- [@Agent](/docs/agents/agent/) — the single-agent annotation
- [@Coordinator](/docs/agents/coordinator/) — multi-agent orchestration and the `delegate_task` edge
- [@AiEndpoint](/docs/tutorial/09-ai-endpoint/) — streaming endpoints and `conversationMemory`
- [Governance Policy Plane](/docs/reference/governance/) — the policies that govern the delegation edge
