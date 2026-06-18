---
title: "MCP Server"
description: "@McpTool, @McpResource, @McpPrompt, @McpParam — annotation-driven MCP server on Atmosphere's transport layer"
---

# MCP Server

The `atmosphere-mcp` module is a **self-contained MCP (Model Context Protocol) server implementation** that rides on Atmosphere's transport layer. There is no external MCP SDK dependency, and it exposes annotation-driven tools, resources, and prompt templates to AI agents over Streamable HTTP, WebSocket, or SSE.

It speaks **two protocol generations side by side**: the session-based JSON-RPC wire protocol (`2024-11-05` through `2025-11-25`, negotiated via the `initialize` handshake) and the stateless **`2026-07-28` release candidate**, chosen per request. Existing clients are unaffected — see [MCP 2026-07-28](#mcp-2026-07-28-release-candidate).

MCP endpoints are auto-registered when `atmosphere-mcp` is on the classpath together with a class annotated with `@Agent` (from `atmosphere-agent`). **There is no `@McpServer` annotation.** Class-level wiring is handled by `@Agent`; method- and parameter-level MCP metadata uses the four annotations in this module.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-mcp</artifactId>
    <version>${project.version}</version>
</dependency>
```

For Spring Boot applications, add the starter and the agent module alongside it:

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-spring-boot-starter</artifactId>
    <version>${project.version}</version>
</dependency>
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-agent</artifactId>
    <version>${project.version}</version>
</dependency>
```

## Quick Start

```java
import org.atmosphere.agent.annotation.Agent;
import org.atmosphere.mcp.annotation.McpParam;
import org.atmosphere.mcp.annotation.McpPrompt;
import org.atmosphere.mcp.annotation.McpResource;
import org.atmosphere.mcp.annotation.McpTool;
import org.atmosphere.mcp.protocol.McpMessage;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@Agent(name = "my-server",
       version = "1.0.0",
       endpoint = "/atmosphere/mcp",
       headless = true)
public class MyMcpServer {

    @McpTool(name = "greet", description = "Say hello")
    public String greet(@McpParam(name = "name", required = true) String name) {
        return "Hello, " + name + "!";
    }

    @McpResource(uri = "atmosphere://server/status",
                 name = "Server Status",
                 description = "Current server status")
    public String serverStatus() {
        return "OK";
    }

    @McpPrompt(name = "summarize", description = "Summarize a topic")
    public List<McpMessage> summarize(@McpParam(name = "topic") String topic) {
        return List.of(
            McpMessage.system("You are a summarization expert."),
            McpMessage.user("Summarize: " + topic)
        );
    }
}
```

## Annotations

All four annotations live in `org.atmosphere.mcp.annotation`.

| Annotation | Target | Description |
|-----------|--------|-------------|
| `@McpTool` | Method | Exposes a method as a callable tool (`tools/call`) |
| `@McpResource` | Method | Exposes a method as a read-only resource (`resources/read`) |
| `@McpPrompt` | Method | Exposes a method as a prompt template (`prompts/get`) |
| `@McpParam` | Parameter | Annotates method parameters with name, description, and required flag |

Class-level registration is done with `@Agent` from `atmosphere-agent` -- see [Core Runtime](/docs/reference/core/) and the [MCP tutorial](/docs/tutorial/13-mcp/) for the full wiring context.

### `@McpTool`

| Attribute | Default | Description |
|-----------|---------|-------------|
| `name` | (required) | Tool name reported to MCP clients |
| `description` | `""` | Human-readable description of what the tool does |
| `title` | `""` | Display title (MCP `2025-06-18`+) |
| `iconUrl` | `""` | Icon URI advertised in `tools/list` (MCP `2025-11-25`) |
| `longRunning` | `false` | Run the call as a Tasks-extension task — the client gets a handle and polls `tasks/get` (MCP `2026-07-28`) |
| `uiResource` | `""` | A `ui://` resource URI advertised in `_meta.ui.resourceUri` — makes the tool an [MCP App](#mcp-apps-sep-1865) (MCP `2026-07-28`) |

Tool methods can return any type that Jackson can serialize (`String`, `List`, `Map`, records, domain objects). They may also declare injectable framework types as parameters -- see [Injectable parameters](#injectable-parameters).

### `@McpResource`

| Attribute | Default | Description |
|-----------|---------|-------------|
| `uri` | (required) | URI or URI template identifying the resource |
| `name` | `""` | Human-readable resource name |
| `description` | `""` | Description of the resource |
| `mimeType` | `"text/plain"` | MIME type of the resource content |

### `@McpPrompt`

| Attribute | Default | Description |
|-----------|---------|-------------|
| `name` | (required) | Prompt template name |
| `description` | `""` | Description of what the prompt does |

Prompt methods return `List<McpMessage>`. The `McpMessage` type (in `org.atmosphere.mcp.protocol`) provides `system(String)` and `user(String)` factory methods.

### `@McpParam`

| Attribute | Default | Description |
|-----------|---------|-------------|
| `name` | (required) | Parameter name reported to MCP clients |
| `description` | `""` | Human-readable description |
| `required` | `true` | Whether the parameter is required |

## Auto-Configuration

The MCP endpoint is registered by the `AgentProcessor` in `atmosphere-agent` during `AtmosphereFramework` initialization. The processor scans classes annotated with `@Agent`, wires their `@McpTool`, `@McpResource`, and `@McpPrompt` methods into an `McpRegistry`, and installs an `McpHandler` on the framework at the resolved MCP path.

### Path resolution

| `@Agent.endpoint` value | MCP path |
|-------------------------|----------|
| Ends in `/mcp` (e.g. `/atmosphere/mcp`) | Used verbatim |
| Any other value, or empty | `/atmosphere/agent/{name}/mcp` |

### Required modules on the classpath

| Module | Why |
|--------|-----|
| `atmosphere-mcp` | The annotations, registry, and protocol runtime |
| `atmosphere-agent` | The `AgentProcessor` that scans `@Agent` classes and registers the MCP handler |
| `atmosphere-runtime` (transitive) | The transport layer |

For Spring Boot apps, `atmosphere-spring-boot-starter` auto-configures the `AtmosphereServlet`, performs annotation scanning through Spring's component scanning, and installs the agent processor automatically. Set `atmosphere.packages` in `application.properties` so the framework knows which packages to scan:

```properties
atmosphere.packages=org.atmosphere.mcp,com.example.mcp
```

There is no MCP-specific Spring Boot auto-configuration class and no `McpProperties` binding -- all MCP behavior is controlled through `@Agent` attributes and the annotations in this module.

### Running on Quarkus

MCP servers also run on the Quarkus extension. Add `atmosphere-agent` and
`atmosphere-mcp` alongside `atmosphere-quarkus-extension`, and set
`quarkus.atmosphere.packages` to your `@Agent` package. The Quarkus build step
recognizes `@Agent` and indexes the agent/mcp jars, so the endpoint, tools, and
OAuth authorization register exactly as they do on Spring Boot.

:::caution[JVM only]
Native image is not yet supported for `@Agent`-based MCP — the agent processor
links optional sibling modules (e.g. AG-UI) at build time, which native-image
analysis rejects when they are absent. No Quarkus MCP sample ships today; the
capability is covered by the extension's authorization test suite.
:::

## Supported Transports

| Transport | How to connect |
|-----------|---------------|
| Streamable HTTP (recommended, MCP 2025-11-25) | `POST http://host:port/atmosphere/mcp` |
| WebSocket | `ws://host:port/atmosphere/mcp` |
| SSE | `GET http://host:port/atmosphere/mcp` |

All three are served from the same registered MCP path. The `McpHandler` dispatches `POST` bodies as JSON-RPC requests (returning either `application/json` or `text/event-stream` responses based on the `Accept` header), uses `GET` to open an SSE notification stream, and uses `DELETE` to terminate a session. Per-session state is tracked via the `Mcp-Session-Id` header, with a 30-minute idle TTL and a 10,000-session cap by default.

Agents get automatic reconnection, heartbeats, and transport fallback from Atmosphere's transport layer.

## MCP 2026-07-28 (Release Candidate)

The `2026-07-28` revision is the largest change to MCP since launch. Atmosphere
implements it as a **stateless dialect that runs alongside** the session model — there is
no migration and no flag day. A request is dispatched to the stateless dialect when it
carries the protocol version in `params._meta` or calls `server/discover`; the
`initialize` handshake and `Mcp-Session-Id` keep routing to the session dialect, so every
`2024-11-05 … 2025-11-25` client behaves exactly as before.

| Capability | Summary |
|-----------|---------|
| **Stateless core** | No session id, no handshake. Client info, capabilities, and version travel in `_meta` on every request, so the server runs behind a plain round-robin load balancer with no session affinity. |
| **Operability headers** | `Mcp-Method` / `Mcp-Name` routing headers, validated against the request body. |
| **Cacheable list/read** | `ttlMs` and `cacheScope` (`public` / `private`) on `tools/list`, `resources/list`, and `resources/read` results. |
| **W3C trace context** | `traceparent` / `tracestate` / `baggage` read from `_meta` and bridged into the OpenTelemetry span (with `atmosphere-tracing`). |
| **Tasks extension** | `io.modelcontextprotocol/tasks`. A `@McpTool(longRunning = true)` call returns a task handle polled via `tasks/get`. |
| **Multi-round-trip** | `InputRequiredResult` + base64 `requestState` — the server requests more input mid-call and resumes statelessly on any instance. |
| **JSON Schema 2020-12** | Tool input schemas advertise the `2020-12` dialect via `$schema`. |
| **Extensions framework** | Reverse-DNS capability map; Tasks and Apps register as official extensions. |
| **MCP Apps** | Tools advertise a `ui://` UI resource — see [MCP Apps](#mcp-apps-sep-1865). |
| **Authorization** | OAuth 2.0 Resource Server — RFC 9728 metadata + bearer-token validation (via a `TokenValidator`) or a framework-set principal — see [Authorization](#authorization). |

:::note[Client scope]
This is the **server** track. The outbound `atmosphere-mcp-client` wraps the official MCP
Java SDK and cannot yet negotiate the `2026-07-28` stateless model — that waits on upstream
SDK support.
:::

### MCP Apps (SEP-1865)

An **MCP App** is a `@McpTool(uiResource = "ui://…")` paired with an `@McpResource` whose
`mimeType` is `text/html;profile=mcp-app`. A host renders the HTML in a sandboxed iframe;
the bundled **Atmosphere console** is a working host (its **MCP Apps** tab). The **App
Bridge** — JSON-RPC over `postMessage` — is **bidirectional**:

- **App → Host → Server** — the app calls server tools through the host, which still runs
  them through the policy gateway, so the app inherits governance.
- **Host → App** — the app declares `appCapabilities.tools`, and the host lists and calls
  the app's own registered tools.

When a distinct origin is available (the `atmosphere.mcp-sandbox-origin` config, or the
`localhost`↔`127.0.0.1` sibling in development), the console renders apps through a
**separate-origin sandbox proxy**: a proxy iframe at a different origin renders the
untrusted HTML in a nested opaque-origin iframe with a derived CSP. With no distinct
origin it falls back to an opaque-origin sandboxed iframe (`allow-scripts`, no
`allow-same-origin`).

### Authorization

When enabled, the MCP server behaves as an **OAuth 2.0 Resource Server**: it serves RFC
9728 protected-resource metadata at `/.well-known/oauth-protected-resource` and answers
unauthenticated requests with `401` and a `WWW-Authenticate` challenge pointing at that
metadata (default-deny). A request is authenticated when **either**:

- a servlet resource-server filter has set the request principal — e.g. Spring Security
  `oauth2ResourceServer` validating a JWT against your issuer; **or**
- a configured `TokenValidator` accepts the `Authorization: Bearer` token. MCP loads it
  from the `org.atmosphere.auth.tokenValidator` init-parameter and validates the bearer
  token itself, so this works on any container — servlet, Spring Boot, and Quarkus (on the
  JVM) — with no framework-specific wiring.

Opt in via init parameters:

```properties
org.atmosphere.mcp.auth.resource=https://api.example.com/atmosphere/mcp
org.atmosphere.mcp.auth.authorizationServers=https://auth.example.com
org.atmosphere.mcp.auth.scopes=mcp:tools mcp:resources
# Validate bearer tokens with your own TokenValidator — or omit and let a servlet
# security filter (e.g. Spring Security) set the request principal instead:
org.atmosphere.auth.tokenValidator=com.example.MyJwtTokenValidator
```

The flow is end-to-end tested on the embedded server, Spring Boot, and Quarkus (JVM).

## Injectable Parameters

`@McpTool` methods can declare framework types as method parameters. These are auto-injected at invocation time and excluded from the JSON schema advertised to MCP clients -- the AI agent never sees them.

| Parameter type | What's injected | Requires |
|----------------|-----------------|----------|
| `Broadcaster` | `BroadcasterFactory.lookup(topic, true)` | A `@McpParam(name = "topic")` argument in the call |
| `StreamingSession` | `BroadcasterStreamingSession` wrapping the topic's `Broadcaster` | A `@McpParam(name = "topic")` argument **and** `atmosphere-ai` on the classpath |
| `AtmosphereConfig` | The framework's `AtmosphereConfig` | Nothing |
| `BroadcasterFactory` | The framework's `BroadcasterFactory` | Nothing |
| `AtmosphereFramework` | The framework instance | Nothing |

### Push messages to browser clients

```java
@McpTool(name = "broadcast", description = "Send a message to a chat topic")
public String broadcast(
        @McpParam(name = "message") String message,
        @McpParam(name = "topic") String topic,
        Broadcaster broadcaster) {
    broadcaster.broadcast(message);
    return "sent to " + topic;
}
```

### Stream LLM output to browsers

With `atmosphere-ai` on the classpath, inject a `StreamingSession` bound to the topic's broadcaster:

```java
@McpTool(name = "ask_ai", description = "Ask AI and stream answer to a topic")
public String askAi(
        @McpParam(name = "question") String question,
        @McpParam(name = "topic") String topic,
        StreamingSession session) {
    Thread.startVirtualThread(() -> {
        var request = ChatCompletionRequest.builder(model).user(question).build();
        client.streamChatCompletion(request, session);
    });
    return "streaming to " + topic;
}
```

## Programmatic Registration

`McpRegistry` supports imperative registration for tools built at runtime:

```java
var registry = new McpRegistry();

registry.registerTool("greet", "Greet a user by name",
    List.of(new McpRegistry.ParamEntry("name", "User name", true, String.class)),
    args -> "Hello, " + args.get("name") + "!"
);

registry.registerResource("atmosphere://app/version",
    "App Version", "Current application version", "text/plain",
    args -> "1.0.0"
);

registry.registerPrompt("welcome", "Welcome message for new users", List.of(),
    args -> List.of(
        McpMessage.system("You are a friendly assistant."),
        McpMessage.user("Welcome the user warmly.")
    )
);
```

Annotation-based and programmatic registrations coexist in the same registry.

## Runtime Classes

| Class | Role |
|-------|------|
| `org.atmosphere.mcp.runtime.McpHandler` | `AtmosphereHandler` that dispatches Streamable HTTP / WebSocket / SSE to the JSON-RPC protocol |
| `org.atmosphere.mcp.runtime.McpProtocolHandler` | Core JSON-RPC processing shared by all transports |
| `org.atmosphere.mcp.runtime.McpSession` | Per-client session state (`Mcp-Session-Id`, pending notifications, TTL) |
| `org.atmosphere.mcp.runtime.McpWebSocketHandler` | WebSocket-specific frame handling |
| `org.atmosphere.mcp.runtime.McpTracing` | OpenTelemetry integration (optional) |
| `org.atmosphere.mcp.registry.McpRegistry` | Annotation scanning + programmatic registration |
| `org.atmosphere.mcp.protocol.McpMessage` | Prompt message factories (`system()`, `user()`) |
| `org.atmosphere.mcp.protocol.McpMethod` | MCP method name constants |
| `org.atmosphere.mcp.protocol.JsonRpc` | JSON-RPC protocol helpers |
| `org.atmosphere.mcp.BiDirectionalToolBridge` | Server-to-client tool call bridge |
| `org.atmosphere.mcp.ToolResponseHandler` | `AtmosphereHandler` for bidirectional tool responses |
| `org.atmosphere.mcp.bridge.McpStdioBridge` | stdio-to-HTTP bridge JAR entry point |

## Bidirectional Tool Bridge

`BiDirectionalToolBridge` lets the server invoke tools on connected clients (browser JavaScript, for example) and receive results asynchronously:

```java
var bridge = new BiDirectionalToolBridge();                      // 30s default
var withTimeout = new BiDirectionalToolBridge(Duration.ofSeconds(10));

CompletableFuture<String> result = bridge.callClientTool(
        resource, "getLocation", Map.of("highAccuracy", true));
```

The bridge tracks pending futures in a `ConcurrentHashMap`, generates UUIDs for correlation, and completes futures exceptionally on timeout (`TimeoutException`) or client-reported errors (`ToolCallException`). To receive client responses, register a `ToolResponseHandler` explicitly:

```java
framework.addAtmosphereHandler("/_mcp/tool-response",
        new ToolResponseHandler(bridge));
```

## Observability

### OpenTelemetry Tracing

`McpTracing` wraps every `tools/call`, `resources/read`, and `prompts/get` invocation in an OTel trace span. Add `opentelemetry-api` to your classpath:

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
    <optional>true</optional>
</dependency>
```

With the Spring Boot starter, `McpTracing` is auto-configured when an `OpenTelemetry` bean is present.

**Span attributes:**

| Attribute | Description |
|-----------|-------------|
| `mcp.tool.name` | Tool/resource/prompt name |
| `mcp.tool.type` | `"tool"`, `"resource"`, or `"prompt"` |
| `mcp.tool.arg_count` | Number of arguments provided |
| `mcp.tool.error` | `true` if invocation failed |

## Connecting Clients

Works with Claude Desktop, VS Code Copilot, Cursor, and any MCP-compatible agent:

```json
{
  "mcpServers": {
    "my-server": { "url": "http://localhost:8080/atmosphere/mcp" }
  }
}
```

For clients that only support stdio, build the bridge JAR with `./mvnw package -Pstdio-bridge -DskipTests -pl modules/mcp` and point the client at the resulting `atmosphere-mcp-*-stdio-bridge.jar`.

## Samples

- `samples/spring-boot-mcp-server/` -- a complete Spring Boot MCP server exposing chat administration tools, server resources, and prompt templates, with a React frontend for human users.

## See Also

- [MCP Tutorial](/docs/tutorial/13-mcp/) -- step-by-step walkthrough
- [AI / LLM Integration](/docs/reference/ai/) -- `@AiEndpoint`, `StreamingSession`, and the AI-to-MCP tool bridge
- [Core Runtime](/docs/reference/core/)
- Module README: `modules/mcp/README.md`

## Source

- Module README: [`modules/mcp/README.md`](https://github.com/Atmosphere/atmosphere/blob/main/modules/mcp/README.md)
