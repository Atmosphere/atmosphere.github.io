---
title: "Deep Agents vs LangChain deepagents"
description: "How Atmosphere's default-on deep-agent harness maps to LangChain's deepagents — a full parity table plus the framework-that-hosts differentiators."
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

**deepagents optimizes the agent you _drive_. Atmosphere optimizes the agent you _deploy_.**

LangChain's [deepagents](https://github.com/langchain-ai/deepagents) is a Python library, built on LangGraph, that upgrades a bare tool loop into a "deep agent" — one with a planning tool, a virtual filesystem, sub-agents, and long-term memory. Atmosphere ships the same deep-agent capability set as a JVM framework: a plain [`@Agent`](/docs/agents/agent/) is a deep agent out of the box (the [harness](/docs/agents/harness/) defaults to `{Harness.ALL}`), and the framework *hosts* it over live WebSocket / SSE / WebTransport with a console UI, across twelve interchangeable `AgentRuntime` backends.

If you are in Python and want a library to call, deepagents is the right tool. If you are on the JVM and want to *deploy* a hosted, governed, portable agent, that is Atmosphere.

## Two surfaces: a library you call vs. a framework that hosts

The projects overlap almost completely on the *agent capability surface* — planning, files, sub-agents, memory, HITL, skills. They differ on what wraps that surface.

| | LangChain deepagents | Atmosphere |
|---|---|---|
| **Shape** | A library — you import it and call it from your own process. | A framework — it hosts your agent and serves clients. |
| **Runtime** | Python / LangGraph. | JVM / Spring Boot / Quarkus. |
| **How a client reaches it** | You write the server/transport yourself. | Live WebSocket / SSE / WebTransport + a built-in console UI, out of the box. |
| **Model backend** | LangChain model integrations. | Twelve interchangeable `AgentRuntime` backends — swap one Maven dependency. |
| **Deep-agent capabilities** | Planning, files, sub-agents, memory, HITL, skills. | The same set, default-on via the harness. |

## Capability parity

Nearly every deep-agent capability deepagents offers has a corresponding Atmosphere primitive, wired by the [harness](/docs/agents/harness/) — a plain `@Agent` / `@Coordinator` gets them with no attribute at all. The one gap today is a language REPL (see the last row); everything else maps directly.

| deepagents capability | Atmosphere primitive | Parity |
|---|---|:---:|
| `write_todos` planning tool | `write_todos` built-in floor (`PlanningTools`), or a native plan surface when the runtime declares `AiCapability.PLANNING` | ✅ |
| Virtual filesystem — `ls` / `read_file` / `write_file` / `edit_file` / `delete` / `glob` / `grep` | The same tools plus `rename` — eight in all (`FileSystemTools`) — over a bounded, conversation-scoped workspace, or a native file surface when the runtime declares `AiCapability.VIRTUAL_FILESYSTEM` | ✅ |
| `execute` — sandboxed shell / code execution | `code_exec` (`CodeExecTool`) and per-tool `@SandboxTool`, container-isolated and default-deny | ✅ |
| `eval` — in-process language REPL / interpreter | No dedicated REPL; sandboxed `execute` runs code in a container instead | — |
| Sub-agents (named specialists) | `@Agent` / `@Coordinator` / `@Fleet` + the built-in `delegate_task` tool | ✅ |
| `task` — dynamic, ephemeral sub-agent spawn | The `task` tool (`SpawnSubagentTool`): a general-purpose sub-agent with an isolated context and workspace | ✅ |
| `interrupt_on` — human-in-the-loop tool gates | `ToolApprovalPolicy` / `GatedToolDispatcher` / `@RequiresApproval` | ✅ |
| Long-term memory (`AGENTS.md`) | `AGENTS.md` + `SOUL.md` + `USER.md` workspace loading plus the `LongTermMemoryInterceptor` | ✅ |
| Skills (`SKILL.md`) | `META-INF/skills/<name>/SKILL.md` convention | ✅ |
| Conversation summarization | Compaction — sliding-window default or `LlmSummarizingCompaction` | ✅ |
| Store backend (persistence) | `LongTermMemory` store plus the checkpoint store | ✅ |
| MCP / bring-your-own tools | `@AiTool` methods plus MCP tool exposure | ✅ |
| Large tool-output offload | Tool-output disk offload (`ToolExecutionHelper`): a result over the threshold spills to a workspace file and the model gets a preview plus a `read_file` pointer | ✅ |
| Composite filesystem backend | `CompositeAgentFileSystem` — one flat namespace routed across bounded backends by longest matching prefix | ✅ |

### The `task` tool in detail

deepagents' `task` tool spawns a fresh general-purpose sub-agent with its own context window for a self-contained subtask, then returns only the final report. Atmosphere's `task` tool (`SpawnSubagentTool`, registered by the harness `DELEGATION` feature on a `@Coordinator` alongside `delegate_task`) does the same: each spawn gets a fresh conversation id, its own plan store, and its own bounded file workspace under a per-spawn temporary root, so the sub-agent's `write_todos` and file tools never touch the parent's. Only the final text report crosses back; the workspace is removed on every exit path. The spawn is governance-checked before dispatch (pre-admission, fail-closed), depth-bounded and spawn-count-bounded, and time-bounded — so recursion cannot run away.

`delegate_task` routes to a *pre-declared* fleet member; `task` creates an *ephemeral* worker on demand. Both ship.

## Atmosphere-only

Where deepagents stops at the agent, Atmosphere keeps going — because it is a framework, not a library.

- **Hosted transport + console.** The agent is served over live WebSocket / SSE / WebTransport with a built-in console UI. It is something you *deploy and clients connect to*, not a function you call inside your own server.
- **Runtime portability.** The same `@Agent` runs on any of twelve `AgentRuntime` backends — the built-in OpenAI-compatible client plus Spring AI, LangChain4j, Google ADK, Embabel, Koog, Semantic Kernel, AgentScope, Spring AI Alibaba, Anthropic, Cohere, and CrewAI — by swapping one Maven dependency. Your annotations, tools, skills, and memory stay identical.
- **Default-on governance.** RAG-injection and memory-injection screens are on by default and fail closed; the fleet-dispatch edge and the `task` spawn are governance-checked before any call runs.
- **Runtime truth in the console.** `/api/console/info` reports each harness primitive's *actual* attached state — `ACTIVE(builtin)`, `ACTIVE(native:<runtime>)`, or `INACTIVE(<reason>)` — never configuration intent.
- **Durable runs.** An opt-in effect journal records what a run did so it replays deterministically after a crash, re-driving committed LLM rounds and tool calls without re-hitting the provider.

## When to use which

Honest guidance, not a scoreboard:

- **Use deepagents** if you are already in Python / LangGraph and want a *library* to add planning, files, and sub-agents to an agent you drive from your own code.
- **Use Atmosphere** if you are on the JVM and want to *deploy* a hosted agent — served over real-time transports with a console, governed by default, portable across runtimes, and durable — where the deep-agent primitives are on out of the box.

The capability sets are close to identical. The decision is about the surface: a Python library you call, or a JVM framework that hosts.

## See also

- [Harness](/docs/agents/harness/) — the default-on deep-agent engine and every primitive it attaches
- [@Agent](/docs/agents/agent/) — the single-agent programming model
- [@Coordinator](/docs/agents/coordinator/) — fleets, `delegate_task`, and the governed dispatch edge
- [AI Adapters](/docs/tutorial/11-ai-adapters/) — the twelve `AgentRuntime` backends and their capability matrix
