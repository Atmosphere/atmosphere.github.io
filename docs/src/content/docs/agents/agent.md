---
title: "@Agent"
description: "The @Agent annotation — wiring AI endpoints, commands, tools, skills, memory, and protocols"
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

`@Agent` is the single entry point for building AI agents with Atmosphere. Annotate a class, and the framework wires the AI endpoint, commands, tools, skill file, the deep-agent [harness](/docs/agents/harness/), and protocol exposure automatically.

```java
@Agent(
    name = "my-agent",
    skillFile = "skills/my-agent.md",
    description = "A helpful assistant"
)
public class MyAgent {

    @Command("/summarize")
    public String summarize(@Param("url") String url) {
        // slash command logic
    }

    @AiTool(description = "Look up a customer by ID")
    public Customer findCustomer(@Param("id") String id) {
        return customerService.find(id);
    }
}
```

## Annotation Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `String` | _(required)_ | Agent name. Used in the registration path (`/atmosphere/agent/{name}`) and in protocol metadata (A2A Agent Card). |
| `skillFile` | `String` | `""` | Classpath resource path to the skill file (`.md`). The entire file becomes the system prompt. Sections are also extracted for protocol metadata. |
| `description` | `String` | `""` | Human-readable description for A2A Agent Card metadata. |
| `endpoint` | `String` | `""` | Custom endpoint path for the agent's A2A protocol endpoint. Overrides the default `/atmosphere/agent/{name}/a2a`. |
| `version` | `String` | `"1.0.0"` | Agent version for Agent Card metadata and protocol responses. |
| `headless` | `boolean` | `false` | When `true`, no WebSocket UI handler is registered — agent operates as a headless A2A/MCP service only. |
| `harness` | `Harness[]` | `{Harness.ALL}` | The [harness](/docs/agents/harness/) features attached to this agent — batteries-included by default: `ALL` expands to `{MEMORY, CACHE, DELEGATION}`. Narrow the set (e.g. `harness = {Harness.MEMORY}`) or declare `harness = {}` to opt the agent down to a bare loop. The app-wide kill switch and `exclude-paths` beat this attribute. Does not apply to [headless](#full-stack-vs-headless-mode) agents — no prompt loop, nothing to complete. |
| `responseAs` | `Class<?>` | `Void.class` | Target Java type for structured output from this agent. Mirrors `@AiEndpoint#responseAs()`. |

## What `@Agent` Wires

| Concern | How it works |
|---------|-------------|
| **AI endpoint** | Registers an HTTP/WebSocket endpoint at `/atmosphere/agent/{name}` |
| **Commands** | Methods annotated with `@Command` become slash commands with type-safe parameters |
| **Tools** | Methods annotated with `@AiTool` are registered as portable tools, callable by any LLM backend |
| **Skill file** | Loaded from the `skillFile` path, or auto-discovered at `META-INF/skills/` by convention |
| **Harness** | The full deep-agent [harness](/docs/agents/harness/) is on by default (`harness()` defaults to `{Harness.ALL}`) — conversation memory, long-term memory, and a conservative prompt-cache default |
| **Protocol exposure** | MCP, A2A, and AG-UI protocols are auto-registered based on classpath dependencies |

## Full-Stack vs Headless Mode

By default, `@Agent` runs in **full-stack mode** — it serves a built-in AI Console UI at the agent's path. Users can interact with the agent directly from a browser.

Set `headless = true` to run in **headless mode** — no UI is served. The agent is only reachable via its protocol endpoints (MCP, A2A, AG-UI) or programmatic API. This is the right mode for agent-to-agent communication.

```java
@Agent(name = "background-worker", headless = true)
public class BackgroundWorker {
    // reachable via A2A, MCP, or direct API — no browser UI
}
```

Headless mode is also **auto-detected**: if the class has `@AgentSkill`/`@AgentSkillHandler` methods but no `@Prompt` method, it is treated as headless.

### Custom Endpoint

Use the `endpoint` attribute to set a custom A2A path for headless agents:

```java
@Agent(name = "research",
       endpoint = "/atmosphere/a2a/research",
       description = "Web research agent")
public class ResearchAgent {
    // A2A endpoint served at /atmosphere/a2a/research
}
```

## Commands

`@Command` methods are user-facing slash commands. Parameters are declared with `@Param` and are type-safe.

```java
@Command(value = "/deploy", description = "Deploy to an environment")
public String deploy(
    @Param("env") String environment,
    @Param(value = "version", required = false) String version
) {
    // deploy logic
}
```

Commands appear in the AI Console UI autocomplete and are also exposed via MCP as tools.

### Destructive Command Confirmation

For commands that perform destructive actions, use the `confirm` attribute to require user confirmation before execution:

```java
@Command(value = "/reset", description = "Reset all data",
         confirm = "This will delete all data. Are you sure?")
public String reset() {
    return dataService.resetAll();
}
```

The client receives a confirmation prompt before the command executes.

## Built-in Console UI

Every full-stack `@Agent` is automatically served by the **Atmosphere AI Console** at `/atmosphere/console/`. The console provides:

- Chat interface with streaming responses
- Tool call visualization in the **AGENT COLLABORATION** panel
- Approval prompts for `@RequiresApproval` tools
- Command autocomplete
- Connection status indicator

No frontend code needed — the console is bundled in `atmosphere-spring-boot-starter`.

## Tools

`@AiTool` methods are callable by the LLM during inference. They work
identically across all twelve `AgentRuntime` adapters (built-in, Spring AI,
LangChain4j, Google ADK, Embabel, Koog, Semantic Kernel, AgentScope,
Spring AI Alibaba, Anthropic, Cohere, CrewAI) — every adapter ships a
tool bridge that routes each invocation through
`ToolExecutionHelper.executeWithApproval`. CrewAI is the only one whose
bridge crosses a process boundary (Java `ToolCallbackServer` over
loopback HTTP to the Python sidecar); the others route in-JVM.

```java
@AiTool(description = "Query the order database")
public List<Order> queryOrders(
    @Param("status") String status,
    @Param(value = "limit", required = false) Integer limit
) {
    return orderRepo.findByStatus(status, limit != null ? limit : 10);
}
```

Tools are automatically registered with the active `AgentRuntime` and are also exposed as MCP tools when the MCP module is on the classpath.

## Skill File

The `skillFile` attribute points to a Markdown file on the classpath that serves as the agent's system prompt. Sections within the file are also extracted for protocol metadata:

- `## Skills` — A2A Agent Card skills
- `## Tools` — cross-referenced with `@AiTool` methods
- `## Channels` — included in system prompt
- `## Guardrails` — included in system prompt (LLM self-enforces)

```java
@Agent(name = "devops", skillFile = "prompts/devops-skill.md")
public class DevOpsAgent { ... }
```

If no `skillFile` is specified, Atmosphere matches by convention — an agent named `devops` will pick up `META-INF/skills/devops.skills` if present.

The companion [`Atmosphere/atmosphere-skills`](https://github.com/Atmosphere/atmosphere-skills)
repository ships a curated registry of skill files — personality
packs, tool bundles, guardrail templates — that work out of the box
with `@Agent`. Pull one with `atmosphere import <url>` (see
[`Skills`](/docs/agents/skills/#importing-skills-from-github)) and
the CLI drops it under `META-INF/skills/` so convention-based
auto-discovery picks it up without a code change.

## Memory and the Harness

A plain `@Agent` is a deep agent out of the box: `harness()` defaults to `{Harness.ALL}`, so the full [harness](/docs/agents/harness/) is on by default —

- **Conversation memory** — session-scoped conversation history, passed to the LLM on every request.
- **Long-term memory** — a `LongTermMemoryInterceptor` extracts facts at session close and recalls them on the next connection.
- **Prompt-cache default** — a `CONSERVATIVE` prompt-cache policy is seeded when the agent declares none.

Opt an agent down to a bare loop with `harness = {}`, or narrow the set (e.g. `harness = {Harness.MEMORY}`). The app-wide `atmosphere.ai.harness.enabled=false` kill switch and `atmosphere.ai.harness.exclude-paths` beat the annotation — see [Harness](/docs/agents/harness/) for the full precedence, configuration keys, and the console runtime-truth block.

Conversation memory is stored in-memory by default. For durable persistence across restarts, add `atmosphere-durable-sessions-sqlite` or `atmosphere-durable-sessions-redis` to the classpath and a `ConversationPersistence` backend is auto-discovered via `ServiceLoader`.

## Relationship to `@ManagedService`

`@Agent` builds on top of `@ManagedService`. An `@Agent` is a `@ManagedService` with AI-specific wiring added. You can still use `@ManagedService` directly for non-AI real-time endpoints (chat rooms, presence, pub/sub). Protocol annotations (`@McpTool`, `@AgentSkill` + `@AgentSkillHandler`) work on both; AG-UI registers automatically when the class has a `@Prompt` method.

## Relationship to `@Coordinator`

For multi-agent orchestration, use [`@Coordinator`](/docs/agents/coordinator/) instead. A coordinator subsumes `@Agent` — it adds fleet management on top of the base agent setup. See the [@Coordinator documentation](/docs/agents/coordinator/) for details.

## See Also

- [Harness](/docs/agents/harness/) — the deep-agent harness: defaults, opt-down, app-wide flag, runtime truth
- [@Coordinator](/docs/agents/coordinator/) — multi-agent orchestration
- [Skills](/docs/agents/skills/) — skill files and auto-discovery
- [A2A Protocol](/docs/agents/a2a/) — agent-to-agent communication
- [AG-UI Protocol](/docs/agents/agui/) — structured agent events for frontends
- [@AiTool](/docs/tutorial/10-ai-tools/) — framework-agnostic tool calling
