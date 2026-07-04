---
title: "Harness"
description: "The deep-agent harness — default-on memory, prompt caching, and delegation for @Agent, @Coordinator, and @AiEndpoint"
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

Atmosphere agents are **deep agents out of the box**. The harness *completes* an agent: on top of whatever endpoint or agent you already have, it adds conversation memory, long-term memory (with a compaction seam), a prompt-cache default, and the fleet delegation primitive — and reports each primitive's *actual* runtime state (never configuration intent) at `/api/console/info`.

The engine is `org.atmosphere.ai.preset.HarnessPreset`, driven by one granular attribute — `harness()` on [`@Agent`](/docs/agents/agent/), [`@Coordinator`](/docs/agents/coordinator/), and [`@AiEndpoint`](/docs/tutorial/09-ai-endpoint/) — typed by the `org.atmosphere.ai.preset.Harness` enum.

## The `Harness` Enum

| Value | What it turns on |
|-------|------------------|
| `Harness.MEMORY` | Conversation memory, the auto-attached long-term-memory interceptor, and the compaction seam on the resolved memory. |
| `Harness.CACHE` | Prompt-cache default seeding — endpoints whose annotation keeps `promptCache = NONE` are seeded with a `CONSERVATIVE` policy. |
| `Harness.DELEGATION` | The fleet delegation primitive — the built-in `delegate_task` tool plus the governance wrap on the outbound dispatch edge. |
| `Harness.ALL` | Sentinel that expands to `{MEMORY, CACHE, DELEGATION}` — the full harness. |

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
    // delegation is on by default: the built-in delegate_task tool is
    // registered and fleet dispatches run through the installed
    // governance policies
}
```

## What Each Feature Attaches

| Primitive | Feature | What the harness does |
|-----------|---------|----------------------|
| Conversation memory | `MEMORY` | Multi-turn history is resolved even when the annotation's `conversationMemory` is `false` (`maxHistoryMessages` is still honored). An annotation value of `true` always wins — the harness never turns memory *off*. |
| Long-term memory | `MEMORY` | Appends a framework-built `LongTermMemoryInterceptor` *after* the user's interceptors: facts are extracted at session close and recalled on the next connection. A user-declared `LongTermMemoryInterceptor` is authoritative and suppresses the harness's. Store resolution: a container-bridged `LongTermMemory` → the highest-priority `ServiceLoader` `LongTermMemoryProvider` → the zero-dep `InMemoryLongTermMemory` fallback. |
| Compaction | `MEMORY` | The conversation-memory compaction seam — sliding-window by default; the harness never forces summarizing. |
| Prompt-cache default | `CACHE` | Endpoints whose annotation keeps `promptCache = NONE` are seeded with a `CONSERVATIVE` `CacheHint` policy, unless the independent `org.atmosphere.ai.prompt-cache.default` init-param overrides it (an explicit `none` there suppresses the seeding). Wire emission stays gated by the `atmosphere.ai.prompt-cache-key` mode and its default-deny host allow-list. |
| Delegation | `DELEGATION` | On a `@Coordinator`: registers the built-in `delegate_task` tool and wraps the fleet's outbound dispatch edge with the installed governance policies. A plain `@Agent` or `@AiEndpoint` has no fleet, so the primitive reports `INACTIVE(no-coordinator)` until a coordinator registers. |

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
