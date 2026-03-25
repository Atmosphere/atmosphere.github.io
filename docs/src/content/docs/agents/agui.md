---
title: "AG-UI Protocol"
description: "AG-UI protocol — @AgUiEndpoint, @AgUiAction, SSE event types, and CopilotKit compatibility"
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

AG-UI (Agent-User Interaction) is CopilotKit's open protocol for connecting AI agents to frontend components. Atmosphere auto-registers AG-UI endpoints when the `atmosphere-agui` module is on the classpath. Your `@Agent` becomes compatible with any AG-UI frontend, including CopilotKit.

## Annotations

### `@AgUiEndpoint`

Marks an `@Agent` or `@ManagedService` as an AG-UI endpoint. The agent will serve SSE events following the AG-UI protocol.

```java
@Agent("/assistant")
@AgUiEndpoint
public class AssistantAgent {
    // AG-UI SSE endpoint is auto-registered
}
```

### `@AgUiAction`

Declares a frontend-callable action. Actions are invoked by the AG-UI client and executed on the server.

```java
@AgUiAction(name = "updateSettings", description = "Update user preferences")
public ActionResult updateSettings(
    @Param("theme") String theme,
    @Param("language") String language
) {
    settingsService.update(theme, language);
    return ActionResult.success();
}
```

## SSE Event Types

AG-UI uses Server-Sent Events with typed event streams. Atmosphere handles the serialization and event framing automatically.

| Event Type | Description |
|-----------|-------------|
| `TEXT_MESSAGE_START` | Begin a new text message |
| `TEXT_MESSAGE_CONTENT` | Stream a chunk of text content |
| `TEXT_MESSAGE_END` | End the current text message |
| `TOOL_CALL_START` | Begin a tool invocation |
| `TOOL_CALL_ARGS` | Stream tool call arguments |
| `TOOL_CALL_END` | End the tool invocation |
| `STATE_SNAPSHOT` | Full state snapshot for frontend synchronization |
| `STATE_DELTA` | Incremental state update |
| `MESSAGES_SNAPSHOT` | Full message history snapshot |
| `RUN_STARTED` | Agent run has started |
| `RUN_FINISHED` | Agent run has completed |
| `RUN_ERROR` | Agent run encountered an error |

## CopilotKit Compatibility

Atmosphere's AG-UI implementation is fully compatible with CopilotKit. Point a CopilotKit frontend at your Atmosphere agent's URL and it works out of the box.

```tsx
// CopilotKit React frontend
import { CopilotKit } from "@copilotkit/react-core";

function App() {
  return (
    <CopilotKit runtimeUrl="https://your-server.com/assistant">
      <YourApp />
    </CopilotKit>
  );
}
```

The agent serves the AG-UI SSE protocol at its configured path. CopilotKit's `useCopilotChat`, `useCopilotAction`, and `useCopilotReadable` hooks connect to it natively.

## State Synchronization

AG-UI supports bidirectional state synchronization between the agent and the frontend. Use `STATE_SNAPSHOT` for full state and `STATE_DELTA` for incremental updates.

```java
@Agent("/dashboard")
@AgUiEndpoint
public class DashboardAgent {

    @AgUiAction(name = "refreshMetrics")
    public ActionResult refreshMetrics() {
        Map<String, Object> metrics = metricsService.getAll();
        // Framework sends STATE_SNAPSHOT to the frontend
        return ActionResult.withState(metrics);
    }
}
```

## Combining with MCP and A2A

AG-UI, MCP, and A2A annotations are composable on the same `@Agent`. Each protocol is served on its own endpoint, all backed by the same agent logic. A single agent can serve a CopilotKit frontend (AG-UI), expose tools to Claude (MCP), and handle tasks from other agents (A2A) simultaneously.
