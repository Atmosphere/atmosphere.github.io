---
title: "A2A Protocol"
description: "Agent-to-Agent protocol — @AgentSkill, @AgentSkillHandler, Agent Cards, and JSON-RPC"
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

A2A (Agent-to-Agent) is Google's open protocol for agent interoperability. Atmosphere auto-registers A2A endpoints when the `atmosphere-a2a` module is on the classpath. Your `@Agent` becomes discoverable by any A2A-compatible agent or orchestrator.

## Annotations

A2A handlers are declared on individual methods of an `@Agent` class. Both `@AgentSkill` and `@AgentSkillHandler` are method-level annotations applied to the same method — `@AgentSkill` carries the skill metadata, `@AgentSkillHandler` marks the method as a registry-eligible dispatch target.

### `@AgentSkill`

Declares skill metadata: a stable identifier, a human-readable name, an optional description, and optional tags. Required elements are `id` and `name`.

```java
@AgentSkill(
    id = "translate",
    name = "Translate",
    description = "Translates text between languages",
    tags = {"nlp", "translation"}
)
```

### `@AgentSkillHandler`

Marker annotation indicating that a method is eligible for A2A skill dispatch. Used in conjunction with `@AgentSkill` on the same method. It has no elements.

```java
@AgentSkill(id = "translate", name = "Translate", description = "Translates text between languages")
@AgentSkillHandler
public void translate(TaskContext task,
                      @AgentSkillParam(name = "text") String text,
                      @AgentSkillParam(name = "target_language") String targetLanguage) {
    var translated = translationService.translate(text, targetLanguage);
    task.complete(translated);
}
```

Handlers return `void` — the reflection invoker discards the return value. Result reporting flows through the `TaskContext` parameter: call `task.complete(String)` on success, `task.fail(String)` on error, or `task.updateStatus(TaskState, String)` for intermediate progress.

### `@AgentSkillParam`

Annotates a parameter of an `@AgentSkillHandler` method with its name and (optionally) description and required flag. Parameters are exposed in the Agent Card's skill definition and validated against the JSON-RPC `params.arguments` map at runtime.

```java
@AgentSkillParam(name = "text", description = "Source text", required = true) String text
```

The element name `name` is required (positional `@AgentSkillParam("text")` is not valid — the annotation has no `value()` element).

## Agent Card Discovery

When `atmosphere-a2a` is on the classpath, Atmosphere publishes an **Agent Card** at `/.well-known/agent.json`. The card describes the agent's identity, skills, and supported protocols.

```json
{
  "name": "translator",
  "description": "Translates text between languages",
  "url": "https://example.com/translator",
  "version": "1.0.0",
  "skills": [
    {
      "id": "translate",
      "name": "Translate",
      "description": "Translates text between languages",
      "tags": ["nlp", "translation"],
      "parameters": {
        "text": { "type": "string", "required": true },
        "target_language": { "type": "string", "required": true }
      }
    }
  ],
  "protocols": ["a2a", "mcp"]
}
```

Other agents discover your agent by fetching this card. Orchestrators like Google ADK use it to determine which agents can handle which tasks.

## JSON-RPC Transport

A2A uses JSON-RPC 2.0 over HTTP. Atmosphere handles serialization, error mapping, and streaming responses automatically.

| Method | Description |
|--------|-------------|
| `tasks/send` | Send a task to the agent and wait for completion |
| `tasks/sendSubscribe` | Send a task and stream progress via SSE |
| `tasks/get` | Check the status of a previously submitted task |
| `tasks/cancel` | Cancel a running task |

## Headless Agents

A2A is designed for agent-to-agent communication. Agents that only serve other agents should use `headless = true`:

```java
@Agent(name = "data-enrichment", headless = true,
       endpoint = "/atmosphere/a2a/data-enrichment")
public class DataEnrichmentAgent {

    @AgentSkill(id = "enrich", name = "Enrich",
                description = "Enriches records with external data")
    @AgentSkillHandler
    public void enrich(TaskContext task,
                       @AgentSkillParam(name = "record") String recordJson) {
        var enriched = enrichmentService.enrich(recordJson);
        task.complete(enriched);
    }
}
```

Headless agents have no browser UI. They are reachable via A2A JSON-RPC, MCP (if on classpath), and programmatic API.

## Combining with MCP and AG-UI

Protocol wiring is composable on the same `@Agent`. AG-UI auto-registers when the `@Agent` has a `@Prompt` method; A2A registers per `@AgentSkillHandler` method; MCP registers per `@McpTool` method. Each protocol is served on its own sub-path, all backed by the same agent class.
