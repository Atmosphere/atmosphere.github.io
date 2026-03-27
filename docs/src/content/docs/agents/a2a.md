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

### `@AgentSkill`

Declares a skill that this agent exposes to other agents. Applied at the class level alongside `@Agent` or `@ManagedService`.

```java
@Agent(name = "translator", headless = true)
@AgentSkill(
    name = "translate",
    description = "Translates text between languages",
    tags = {"nlp", "translation"}
)
public class TranslatorAgent {
    // ...
}
```

### `@AgentSkillHandler`

Marks a method as the handler for incoming A2A task requests. The method receives the task payload and returns a result.

```java
@AgentSkillHandler
public TaskResult handleTranslation(
    @AgentSkillParam("text") String text,
    @AgentSkillParam("targetLanguage") String targetLanguage
) {
    String translated = translationService.translate(text, targetLanguage);
    return TaskResult.completed(translated);
}
```

### `@AgentSkillParam`

Declares a parameter on an `@AgentSkillHandler` method. Parameters are exposed in the Agent Card's skill definition and validated at runtime.

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
      "name": "translate",
      "description": "Translates text between languages",
      "tags": ["nlp", "translation"],
      "parameters": {
        "text": { "type": "string", "required": true },
        "targetLanguage": { "type": "string", "required": true }
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
@Agent(name = "data-enrichment", headless = true)
@AgentSkill(name = "enrich", description = "Enriches records with external data")
public class DataEnrichmentAgent {

    @AgentSkillHandler
    public TaskResult enrich(@AgentSkillParam("record") String recordJson) {
        // enrich and return
    }
}
```

Headless agents have no browser UI. They are reachable via A2A JSON-RPC, MCP (if on classpath), and programmatic API.

## Combining with MCP and AG-UI

Protocol annotations are composable. An `@Agent` can expose `@AgentSkill`, `@McpTool`, and `@AgUiEndpoint` simultaneously — each protocol is served on its own endpoint, all backed by the same agent logic.
