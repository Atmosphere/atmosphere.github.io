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

`@Agent` is the single entry point for building AI agents with Atmosphere. Annotate a class, and the framework wires the AI endpoint, commands, tools, skill file, conversation memory, and protocol exposure automatically.

```java
@Agent(
    value = "/my-agent",
    skills = "classpath:skills/my-agent.skills",
    memory = true
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

## What `@Agent` Wires

| Concern | How it works |
|---------|-------------|
| **AI endpoint** | Registers an HTTP/WebSocket endpoint at the path you specify |
| **Commands** | Methods annotated with `@Command` become slash commands with type-safe parameters |
| **Tools** | Methods annotated with `@AiTool` are registered as portable tools, callable by any LLM backend |
| **Skill file** | Loaded from the path in `skills`, or auto-discovered at `META-INF/skills/` on the classpath |
| **Conversation memory** | When `memory = true`, session-scoped conversation history is maintained automatically |
| **Protocol exposure** | MCP, A2A, and AG-UI protocols are auto-registered based on classpath dependencies |

## Full-Stack vs Headless Mode

By default, `@Agent` runs in **full-stack mode** — it serves a built-in AI Console UI at the agent's path. Users can interact with the agent directly from a browser.

Set `headless = true` to run in **headless mode** — no UI is served. The agent is only reachable via its protocol endpoints (MCP, A2A, AG-UI) or programmatic API. This is the right mode for agent-to-agent communication.

```java
@Agent(value = "/background-worker", headless = true)
public class BackgroundWorker {
    // reachable via A2A, MCP, or direct API — no browser UI
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

## Tools

`@AiTool` methods are callable by the LLM during inference. They work identically across all backends (built-in, Spring AI, LangChain4j, Google ADK, Embabel).

```java
@AiTool(description = "Query the order database")
public List<Order> queryOrders(
    @Param("status") String status,
    @Param(value = "limit", required = false) Integer limit
) {
    return orderRepo.findByStatus(status, limit != null ? limit : 10);
}
```

Tools are automatically registered with the active LLM backend and are also exposed as MCP tools when the MCP module is on the classpath.

## Conversation Memory

When `memory = true`, Atmosphere maintains a session-scoped conversation history. The history is passed to the LLM on every request, giving the agent context about previous exchanges.

Memory is stored in-memory by default. For durable persistence, configure a `MemoryStore` implementation.

## Relationship to `@ManagedService`

`@Agent` builds on top of `@ManagedService`. An `@Agent` is a `@ManagedService` with AI-specific wiring added. You can still use `@ManagedService` directly for non-AI real-time endpoints (chat rooms, presence, pub/sub). Protocol annotations (`@McpTool`, `@AgentSkill`, `@AgUiEndpoint`) work on both.
