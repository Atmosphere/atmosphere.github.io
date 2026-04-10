---
title: "AI Testing"
description: "atmosphere-ai-test — AiTestClient, AiResponse, and fluent AiAssertions for JUnit 5"
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

The `atmosphere-ai-test` module provides testing utilities for AI endpoints. `AiTestClient` captures streaming text, events, and metadata from an `AgentRuntime` execution, and `AiAssertions` offers a fluent API for verifying the results in JUnit 5.

## Dependency

```xml
<properties>
    <atmosphere.version>4.0.36-SNAPSHOT</atmosphere.version>
</properties>

<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-ai-test</artifactId>
    <version>${atmosphere.version}</version>
    <scope>test</scope>
</dependency>
```

Maven 3.5+ no longer resolves `<version>LATEST</version>` for regular dependencies; pin an explicit version. A `<properties>` placeholder keeps cross-module upgrades to a single line.

## Quick Start

```java
import static org.atmosphere.ai.test.AiAssertions.assertThat;

class MyAgentTest {

    @Test
    void weatherToolIsCalled() {
        var client = new AiTestClient(myAgentRuntime);
        var response = client.prompt("What's the weather in Tokyo?");

        assertThat(response)
            .hasToolCall("get_weather")
                .withArgument("city", "Tokyo")
                .hasResult()
                .and()
            .containsText("Tokyo")
            .completedWithin(Duration.ofSeconds(10))
            .hasNoErrors();
    }
}
```

## AiTestClient

`AiTestClient` wraps an `AgentRuntime` and executes prompts synchronously, capturing everything the runtime produces through the `StreamingSession`.

### Constructor

```java
var client = new AiTestClient(myAgentRuntime);
```

Pass any `AgentRuntime` implementation — the built-in runtime, a Spring AI runtime, a LangChain4j runtime, or a mock.

### Sending Prompts

```java
// Simple prompt
AiResponse response = client.prompt("Explain WebSockets");

// Prompt with system prompt
AiResponse response = client.prompt("Explain WebSockets",
    "You are a networking expert. Be concise.");
```

Both methods block until the runtime completes (or a 30-second timeout is reached) and return an `AiResponse` with all captured data.

## AiResponse

`AiResponse` is a record that captures the full output of an AI endpoint execution:

| Field | Type | Description |
|-------|------|-------------|
| `text` | `String` | The full accumulated text response |
| `events` | `List<AiEvent>` | All `AiEvent` instances emitted during streaming |
| `metadata` | `Map<String, Object>` | Metadata key-value pairs sent during streaming |
| `errors` | `List<String>` | Error messages, if any |
| `elapsed` | `Duration` | Total wall-clock time for the response |
| `completed` | `boolean` | Whether the stream completed normally (vs error/timeout) |

### Querying Events

```java
// Get all events of a specific type
List<AiEvent.ToolStart> toolStarts = response.eventsOfType(AiEvent.ToolStart.class);

// Check if a specific tool was called
boolean called = response.hasToolCall("get_weather");

// Check if a tool returned a result
boolean hasResult = response.hasToolResult("get_weather");

// Check for errors
boolean errored = response.hasErrors();
```

## AiAssertions

Fluent assertion API that integrates with JUnit 5. Import statically:

```java
import static org.atmosphere.ai.test.AiAssertions.assertThat;
```

### Text Assertions

```java
assertThat(response)
    .containsText("WebSocket")    // response text contains substring
    .containsText("real-time");
```

### Completion Assertions

```java
assertThat(response)
    .isComplete()                              // stream completed normally
    .completedWithin(Duration.ofSeconds(5))    // completed within time limit
    .hasNoErrors();                            // no errors occurred
```

### Tool Call Assertions

```java
assertThat(response)
    .hasToolCall("get_weather")           // tool was called
        .withArgument("city", "Tokyo")    // with this argument
        .hasResult()                      // and produced a result
        .and()                            // back to parent assertions
    .hasToolCall("convert_temperature")
        .withArgument("from_unit", "C");
```

### Event Type Assertions

```java
assertThat(response)
    .containsEventType(AiEvent.TextDelta.class)    // at least one TextDelta
    .containsEventType(AiEvent.ToolStart.class);   // at least one ToolStart
```

### Metadata Assertions

```java
assertThat(response)
    .hasMetadata("cost")       // metadata key exists
    .hasMetadata("model");
```

### Chaining

All assertions return `this` (or a sub-assertion object with `.and()` to return), so they chain naturally:

```java
assertThat(response)
    .isComplete()
    .hasNoErrors()
    .containsText("result")
    .hasToolCall("search")
        .withArgument("query", "AI")
        .hasResult()
        .and()
    .completedWithin(Duration.ofSeconds(15))
    .hasMetadata("cost");
```

## Testing Patterns

### Testing with a Mock Runtime

```java
class MockRuntime implements AgentRuntime {
    @Override public String name() { return "mock"; }
    @Override public boolean isAvailable() { return true; }
    @Override public int priority() { return 0; }
    @Override public void configure(AiConfig.LlmSettings settings) { }

    @Override
    public void execute(AgentExecutionContext context, StreamingSession session) {
        session.send("Hello from mock!");
        session.complete();
    }
}

@Test
void mockResponse() {
    var client = new AiTestClient(new MockRuntime());
    var response = client.prompt("Hi");

    assertThat(response)
        .containsText("Hello from mock!")
        .isComplete()
        .hasNoErrors();
}
```

### Testing Tool Calling

```java
@Test
void toolsAreInvokedCorrectly() {
    var client = new AiTestClient(runtime);
    var response = client.prompt("What's 72°F in Celsius?");

    assertThat(response)
        .hasToolCall("convert_temperature")
            .withArgument("value", 72.0)
            .withArgument("from_unit", "F")
            .hasResult()
            .and()
        .containsText("22")   // 72°F ≈ 22.2°C
        .hasNoErrors();
}
```

### Testing Error Handling

```java
@Test
void handlesRuntimeErrors() {
    var client = new AiTestClient(failingRuntime);
    var response = client.prompt("trigger error");

    assertTrue(response.hasErrors());
    assertFalse(response.completed());
    assertTrue(response.errors().stream()
        .anyMatch(e -> e.contains("expected error")));
}
```

### Performance Testing

```java
@Test
void respondsWithinSLA() {
    var client = new AiTestClient(productionRuntime);
    var response = client.prompt("Simple question");

    assertThat(response)
        .isComplete()
        .completedWithin(Duration.ofSeconds(5));

    // Also check raw elapsed time
    assertTrue(response.elapsed().toMillis() < 5000,
        "Response took " + response.elapsed().toMillis() + "ms");
}
```

## See Also

- [AI / LLM Reference](/docs/reference/ai/) — `AgentRuntime`, `StreamingSession`, `AiEvent`
- [@AiTool](/docs/tutorial/10-ai-tools/) — defining framework-agnostic tools
- [AI Filters & Routing](/docs/tutorial/12-ai-filters/) — filters, guardrails, and routing
