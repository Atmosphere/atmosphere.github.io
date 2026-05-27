---
title: "AG-UI Protocol"
description: "AG-UI protocol — auto-bridge from @Agent + @Prompt to AG-UI SSE, with CopilotKit compatibility"
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

AG-UI (Agent-User Interaction) is CopilotKit's open protocol for connecting AI agents to frontend components. When the `atmosphere-agui` module is on the classpath, every `@Agent` that exposes a `@Prompt` method is auto-bridged into the AG-UI SSE protocol — no extra annotation is required.

## How auto-registration works

For each `@Agent` with a `@Prompt(String, StreamingSession)` method, the framework registers an `AgUiHandler` at `{basePath}/agui` (where `basePath` defaults to `/atmosphere/agent/{name}` or the explicit `endpoint` value on `@Agent`). Incoming AG-UI POST requests are parsed into a `RunContext`, the bridge extracts `lastUserMessage()`, and the agent's existing `@Prompt` method is invoked with that message and a streaming session that emits AG-UI SSE events.

```java
@Agent(name = "assistant", endpoint = "/atmosphere/a2a/assistant")
public class AssistantAgent {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        // Tokens written here are framed as AG-UI TEXT_MESSAGE_CONTENT events.
        session.send("Hello, " + message);
        session.complete();
    }
}
```

Because the AG-UI endpoint is wired off the same `@Prompt` method, every AI pipeline feature (interceptors, guardrails, tool calling, memory) applies uniformly to the AG-UI path and to any other protocol the agent exposes.

## Custom AG-UI handlers (`@AgUiAction`)

For cases where the AG-UI signature needs direct access to the `RunContext` (multi-turn state, forwarded props, tool descriptors), a method can be annotated `@AgUiAction` and wired through `AgUiHandler` explicitly:

```java
@AgUiAction
public void handleRun(RunContext context, AgUiStreamingSession session) {
    var userMessage = context.lastUserMessage();
    // emit AG-UI events through the session
    session.send("Processing: " + userMessage);
    session.complete();
}
```

`@AgUiAction` is a bare marker (no elements). The handler's required signature is `(RunContext, AgUiStreamingSession)`. This path is used by the AG-UI module's own tests; the auto-registration described above is the everyday API.

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

Atmosphere's AG-UI implementation is compatible with CopilotKit. Point a CopilotKit frontend at the agent's AG-UI URL and the standard hooks work without additional adapter code.

```tsx
// CopilotKit React frontend
import { CopilotKit } from "@copilotkit/react-core";

function App() {
  return (
    <CopilotKit runtimeUrl="https://your-server.com/atmosphere/agent/assistant/agui">
      <YourApp />
    </CopilotKit>
  );
}
```

The agent serves the AG-UI SSE protocol at `{basePath}/agui`. CopilotKit's `useCopilotChat`, `useCopilotAction`, and `useCopilotReadable` hooks connect to it natively.

## Combining with MCP and A2A

AG-UI, MCP, and A2A wiring are independent and additive on the same `@Agent`. Each protocol is registered on its own sub-path (`/agui`, `/mcp`, `/a2a`), all backed by the same agent logic. A single agent can serve a CopilotKit frontend (AG-UI), expose tools to MCP clients, and handle A2A skill calls simultaneously.
