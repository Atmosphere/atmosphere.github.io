---
title: "@Coordinator"
description: "Multi-agent orchestration — @Coordinator, @Fleet, AgentFleet, parallel fan-out, and sequential pipelines"
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

`@Coordinator` is the entry point for multi-agent orchestration. A coordinator manages a **fleet** of agents — delegating tasks, aggregating results, and streaming a synthesized response to the client. It subsumes `@Agent`: the processor delegates to `AgentProcessor` internally for base agent setup, then adds fleet wiring on top.

```java
@Coordinator(name = "ceo", skillFile = "prompts/ceo-skill.md")
@Fleet({
    @AgentRef(type = ResearchAgent.class),
    @AgentRef(type = StrategyAgent.class),
    @AgentRef(type = FinanceAgent.class),
    @AgentRef(value = "writer", required = false)
})
public class CeoCoordinator {

    @Prompt
    public void onPrompt(String message, AgentFleet fleet, StreamingSession session) {
        // Fan out to all agents in parallel
        var results = fleet.parallel(
            fleet.call("research", "web_search", Map.of("query", message)),
            fleet.call("strategy", "analyze", Map.of("topic", message)),
            fleet.call("finance", "forecast", Map.of("query", message))
        );

        // Synthesize results into a final response
        var synthesis = results.values().stream()
            .map(AgentResult::text)
            .collect(Collectors.joining("\n\n"));

        session.stream("Based on the team's analysis:\n\n" + synthesis);
    }
}
```

## Annotations

### `@Coordinator`

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `String` | _(required)_ | Coordinator name. Used in the registration path and protocol metadata. |
| `skillFile` | `String` | `""` | Classpath resource path to the skill file (`.md`). The entire file becomes the system prompt. |
| `description` | `String` | `""` | Human-readable description for Agent Card metadata. |
| `version` | `String` | `"1.0.0"` | Coordinator version for Agent Card metadata. |
| `responseAs` | `Class<?>` | `Void.class` | Target Java type for structured output from the coordinator's LLM synthesis. When set, the framework wraps the session with `StructuredOutputCapturingSession`, parses the LLM JSON response into the type, and emits `EntityStart` / `StructuredField` / `EntityComplete` events. Mirrors `@AiEndpoint#responseAs()`. |
| `journalFormat` | `Class<? extends JournalFormat>` | `JournalFormat.class` (disabled) | Auto-emit a coordination journal as a tool card after `@Prompt` completes. Use `JournalFormat.Markdown.class` or a custom implementation; the framework emits a `ToolStart` / `ToolResult` event pair. |

### `@Fleet`

Applied at class level alongside `@Coordinator`. Declares the set of agents the coordinator manages. Acts as both documentation and a startup validation contract.

```java
@Fleet({
    @AgentRef(type = ResearchAgent.class),
    @AgentRef(value = "finance", version = "2.0.0"),
    @AgentRef(value = "analytics", required = false)
})
```

### `@AgentRef`

References an agent within a `@Fleet`. Exactly one of `value` (name-based) or `type` (class-based) must be specified.

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `value` | `String` | `""` | Agent name — for remote agents or cross-module references. Must match `@Agent(name=...)` or `@Coordinator(name=...)`. |
| `type` | `Class<?>` | `void.class` | Agent class — compile-safe. The processor reads `@Agent(name=...)` from the class to resolve the name. |
| `version` | `String` | `""` | Expected agent version. Advisory — logged and warned at startup, not enforced. |
| `required` | `boolean` | `true` | If `false`, coordinator starts even if this agent is unavailable. |
| `weight` | `int` | `1` | Preference weight for routing decisions. Higher values = stronger preference. |
| `maxRetries` | `int` | `0` | Maximum retry attempts for transient failures. `0` disables retries. Uses exponential backoff starting at 100ms (100ms, 200ms, 400ms, ...). |
| `circuitBreaker` | `boolean` | `false` | Enable circuit-breaker protection. When `true`, the proxy is wrapped with `ResilientAgentProxy` which fast-fails once the circuit is open after repeated failures. |
| `timeoutMs` | `long` | `0` | Per-agent call timeout in milliseconds. `0` means "use fleet default" (120s). Overrides the global parallel timeout for this specific agent. |

**Class-based references** are compile-safe and provide IDE navigation:

```java
@AgentRef(type = ResearchAgent.class)
```

**Name-based references** work for remote agents or cross-module references:

```java
@AgentRef(value = "finance", version = "2.0.0")
```

## AgentFleet

`AgentFleet` is injected into `@Prompt` methods of `@Coordinator` classes. It provides agent discovery and delegation.

### Discovery

```java
// Get a proxy to a named agent (throws if not found)
AgentProxy research = fleet.agent("research");

// All agents in this fleet (declared via @Fleet)
List<AgentProxy> all = fleet.agents();

// Only currently available agents (filters out unavailable optional agents)
List<AgentProxy> ready = fleet.available();
```

### Direct Calls

Call a single agent directly through its proxy:

```java
AgentProxy research = fleet.agent("research");

// Synchronous call
AgentResult result = research.call("web_search", Map.of("query", "AI trends 2026"));
System.out.println(result.text());

// Async call
CompletableFuture<AgentResult> future = research.callAsync("web_search", Map.of("query", "AI trends"));
```

### Streaming

Stream results token by token:

```java
fleet.agent("writer").stream("draft_report", Map.of("topic", "AI trends"),
    token -> session.send(token),   // onToken
    () -> session.complete()         // onComplete
);
```

### Parallel Fan-Out

Execute multiple agent calls concurrently and collect all results:

```java
var results = fleet.parallel(
    fleet.call("research", "web_search", Map.of("query", message)),
    fleet.call("strategy", "analyze", Map.of("topic", message)),
    fleet.call("finance", "forecast", Map.of("query", message))
);

// Results keyed by agent name
String researchText = results.get("research").text();
String strategyText = results.get("strategy").text();
String financeText = results.get("finance").text();
```

### Sequential Pipeline

Execute calls one after another, feeding results forward:

```java
AgentResult finalResult = fleet.pipeline(
    fleet.call("research", "web_search", Map.of("query", message)),
    fleet.call("writer", "draft_report", Map.of("topic", message))
);
// finalResult is the output of the last agent in the pipeline
```

## AgentProxy

Each agent in the fleet is represented by an `AgentProxy`. The proxy encapsulates transport — the coordinator doesn't know or care whether the agent is local (in-process) or remote (A2A JSON-RPC).

| Method | Description |
|--------|-------------|
| `name()` | Agent name |
| `version()` | Agent version string |
| `isAvailable()` | Whether the agent is currently reachable |
| `weight()` | Preference weight from `@AgentRef` |
| `isLocal()` | `true` for in-process agents, `false` for remote A2A agents |
| `call(skill, args)` | Synchronous call, returns `AgentResult` |
| `callAsync(skill, args)` | Async call, returns `CompletableFuture<AgentResult>` |
| `stream(skill, args, onToken, onComplete)` | Streaming call with token-by-token delivery |
| `callWithHandle(skill, args)` | Start an async call on a virtual thread and return a cancellable `AgentExecution` handle that can be joined or cancelled independently |

### AgentFleet reference

Default-method additions on `AgentFleet` cover cancellable fan-out, live health, and per-scope listeners:

| Method | Description |
|--------|-------------|
| `parallelCancellable(AgentCall... calls)` | Dispatch calls in parallel and return `Map<String, AgentExecution>` — non-blocking; callers control when to `join()` or `cancel()` individual executions. Duplicate agent names are disambiguated with `#2`, `#3` suffixes. |
| `health()` | Snapshot of fleet health — per-agent availability, circuit-breaker state (`ResilientAgentProxy`), and recent failure counts. Streamable to clients for live dashboards. |
| `withActivityListener(AgentActivityListener)` | Returns a new fleet instance with an additional activity listener. Use inside a `@Prompt` method to wire a per-session `StreamingActivityListener(session)` so every downstream call emits streaming tool-card events. |
| `journal()` | Access the `CoordinationJournal` for querying past events. Returns `CoordinationJournal.NOOP` when journaling is disabled. |
| `evaluate(result, originalCall)` | Run all registered `ResultEvaluator`s on a result. Returns an empty list if no evaluators are configured. |

```java
@Prompt
public void onPrompt(String message, AgentFleet fleet, StreamingSession session) {
    // Wire session-scoped streaming on every agent call
    var liveFleet = fleet.withActivityListener(new StreamingActivityListener(session));

    // Fan out with cancellable handles
    var running = liveFleet.parallelCancellable(
        liveFleet.call("research", "web_search", Map.of("query", message)),
        liveFleet.call("strategy", "analyze", Map.of("topic", message))
    );

    // Publish live fleet health to the client
    session.metadata("fleet.health", liveFleet.health());

    running.values().forEach(AgentExecution::join);
}
```

## AgentResult

Results from agent delegation are returned as `AgentResult` records:

| Field | Type | Description |
|-------|------|-------------|
| `agentName` | `String` | Name of the agent that produced the result |
| `skillId` | `String` | The skill that was invoked |
| `text` | `String` | The text response |
| `metadata` | `Map<String, Object>` | Additional metadata from the agent |
| `duration` | `Duration` | Wall-clock time for the call |
| `success` | `boolean` | Whether the call succeeded |

```java
AgentResult result = fleet.agent("research").call("search", Map.of("q", "AI"));

if (result.success()) {
    session.stream(result.text());
} else {
    session.stream(result.textOr("Research agent unavailable, proceeding without it."));
}
```

## Transport: Local vs Remote

The coordinator automatically selects the right transport for each agent:

- **Local agents** (same JVM): Direct method invocation via `LocalAgentTransport`. Zero serialization overhead.
- **Remote agents** (A2A): JSON-RPC 2.0 over HTTP via `A2aAgentTransport`. Discovered via Agent Card at `/.well-known/agent.json`.

The coordinator doesn't need to know which transport is in use — the `AgentProxy` abstracts it.

## Optional Agents

Mark agents as optional when their absence should not prevent the coordinator from starting:

```java
@Fleet({
    @AgentRef(type = ResearchAgent.class),                      // required (default)
    @AgentRef(value = "analytics", required = false),           // optional
    @AgentRef(value = "premium-insights", required = false)     // optional
})
```

At startup, required agents that are unavailable cause a startup failure with a clear error message. Optional agents that are unavailable are logged as warnings and excluded from `fleet.available()`.

In the `@Prompt` method, check availability before calling optional agents:

```java
AgentProxy analytics = fleet.agent("analytics");
if (analytics.isAvailable()) {
    var result = analytics.call("analyze", Map.of("data", message));
    session.stream("Analytics: " + result.text());
}
```

## Weighted Routing

Use weights for preference-based routing when multiple agents can handle the same skill:

```java
@Fleet({
    @AgentRef(type = PrimaryResearchAgent.class, weight = 10),
    @AgentRef(type = BackupResearchAgent.class, weight = 1)
})
```

Higher weight values indicate stronger preference.

## Complete Example

The `spring-boot-multi-agent-startup-team` sample demonstrates a CEO coordinator orchestrating 4 specialist agents:

```java
@Coordinator(name = "ceo", skillFile = "prompts/ceo-skill.md",
             description = "CEO coordinator that orchestrates specialist agents")
@Fleet({
    @AgentRef(type = ResearchAgent.class),
    @AgentRef(type = StrategyAgent.class),
    @AgentRef(type = FinanceAgent.class),
    @AgentRef(type = WriterAgent.class)
})
public class CeoCoordinator {

    @Prompt
    public void onPrompt(String message, AgentFleet fleet, StreamingSession session) {
        session.progress("Dispatching to specialist agents...");

        // Fan out research, strategy, and finance in parallel
        var results = fleet.parallel(
            fleet.call("research", "web_search", Map.of("query", message)),
            fleet.call("strategy", "analyze", Map.of("topic", message)),
            fleet.call("finance", "forecast", Map.of("query", message))
        );

        // Feed parallel results into the writer sequentially
        var briefing = results.values().stream()
            .map(r -> "## " + r.agentName() + "\n" + r.text())
            .collect(Collectors.joining("\n\n"));

        var report = fleet.agent("writer").call("draft_report",
            Map.of("content", briefing, "style", "executive summary"));

        session.stream(report.text());
    }
}
```

Each specialist agent is a standard `@Agent`:

```java
@Agent(name = "research", skillFile = "prompts/research-skill.md",
       description = "Web research specialist")
public class ResearchAgent {

    @AgentSkill(id = "web_search", name = "Web Search",
                description = "Search the web for information")
    @AgentSkillHandler
    public void search(TaskContext task,
                       @AgentSkillParam(name = "query") String query) {
        // perform research
        task.addArtifact(Artifact.text("Research results for: " + query));
        task.complete("Research complete");
    }
}
```

### Runtime Switching

The same `@Coordinator` code works with any AI runtime. Switch the execution engine by changing a single Maven dependency:

```xml
<!-- Built-in (default) -->
<artifactId>atmosphere-ai</artifactId>

<!-- Or Spring AI -->
<artifactId>atmosphere-spring-ai</artifactId>

<!-- Or LangChain4j -->
<artifactId>atmosphere-langchain4j</artifactId>

<!-- Or Google ADK -->
<artifactId>atmosphere-adk</artifactId>
```

## Coordination Journal

Every coordination is automatically journaled — which agents were called, what they returned, timing, success/failure. The journal is a pluggable SPI (`CoordinationJournal`) with an in-memory default, discovered via `ServiceLoader`.

```java
// After parallel execution, query the journal
var events = fleet.journal().retrieve(coordinationId);
var failed = fleet.journal().query(CoordinationQuery.forAgent("weather"));
```

Event types: `Started`, `Dispatched`, `Completed`, `Failed`, `Evaluated`. Each event includes the agent name, skill/method called, timestamp, duration, and result summary.

## Agent Handoffs

An agent can transfer the conversation — with full history — to another agent. One method call:

```java
@Prompt
public void onPrompt(String message, StreamingSession session) {
    if (message.toLowerCase().contains("billing")) {
        session.handoff("billing", message);  // conversation history travels with it
        return;
    }
    session.stream(message);
}
```

The client receives an `AiEvent.Handoff` event before the target agent responds. Nested handoffs are blocked (cycle guard). The target agent's `@Prompt` method runs with its own tools, system prompt, and interceptor chain.

## Conditional Routing

Route based on agent results — first match wins, with an optional fallback:

```java
var weather = fleet.agent("weather").call("forecast", Map.of("city", city));

var result = fleet.route(weather, route -> route
    .when(r -> r.success() && r.text().contains("sunny"),
          f -> f.agent("outdoor").call("plan", Map.of()))
    .when(r -> r.success(),
          f -> f.agent("indoor").call("suggest", Map.of()))
    .otherwise(f -> AgentResult.failure("router", "route",
          "Weather unavailable", Duration.ZERO))
);
```

Every routing decision is recorded in the `CoordinationJournal`.

## Result Evaluation

Plug in quality assessment via the `ResultEvaluator` SPI. Evaluators run automatically (async, non-blocking, recorded in journal) after each agent call, and can be invoked explicitly:

```java
var result = fleet.agent("writer").call("draft", Map.of("topic", "AI"));
var evals = fleet.evaluate(result, call);
if (evals.stream().allMatch(Evaluation::passed)) {
    session.stream(result.text());
}
```

## Long-Term Memory

Agents remember users across sessions. Configuration-only — no code changes in `@Agent` classes:

```java
// LongTermMemoryInterceptor (pre): injects stored facts into system prompt
// LongTermMemoryInterceptor (post): extracts new facts via LLM

// Extraction strategies:
MemoryExtractionStrategy.onSessionClose()  // default — batch, cost-efficient
MemoryExtractionStrategy.perMessage()       // real-time, expensive
MemoryExtractionStrategy.periodic(5)        // every 5 messages
```

Backed by `InMemoryLongTermMemory` (dev) or any `SessionStore` implementation (Redis, SQLite). The `onDisconnect` lifecycle hook ensures facts are extracted before conversation history is cleared.

## Testing

The coordinator module includes test stubs for exercising `@Prompt` methods without infrastructure or LLM calls:

```java
var fleet = StubAgentFleet.builder()
    .agent("weather", "Sunny, 72F in Madrid")
    .agent("activities", "Visit Retiro Park, Prado Museum")
    .build();

coordinator.onPrompt("What to do in Madrid?", fleet, session);

CoordinatorAssertions.assertThat(result)
    .succeeded()
    .containsText("Madrid")
    .completedWithin(Duration.ofSeconds(5));
```

`StubAgentFleet` returns canned responses. `StubAgentTransport` allows predicate-based routing for more complex scenarios.

## Eval Assertions

LLM-as-judge for testing agent response quality. Uses any `AgentRuntime` as the judge model:

```java
var judge = new LlmJudge(cheapRuntime, "gpt-4o-mini");
var response = client.prompt("Should I bring an umbrella to Tokyo?");

assertThat(response)
    .withJudge(judge)
    .forPrompt("Should I bring an umbrella to Tokyo?")
    .meetsIntent("Recommends whether to bring an umbrella based on weather data")
    .isGroundedIn("get_weather")
    .hasQuality(q -> q.relevance(0.8).coherence(0.7).safety(0.9));
```

See [AI Testing](/docs/reference/testing/) for the full assertion API.

## Console UI

The built-in AI Console renders coordinator activity as **tool cards** — showing each specialist agent's work (tool name, input, result) before displaying the synthesized response. This gives users visibility into the multi-agent orchestration process.

## See Also

- [@Agent](/docs/agents/agent/) — single-agent annotation
- [A2A Protocol](/docs/agents/a2a/) — agent-to-agent communication protocol
- [Skills](/docs/agents/skills/) — skill files and auto-discovery
- [spring-boot-multi-agent-startup-team](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-multi-agent-startup-team) — full working sample
