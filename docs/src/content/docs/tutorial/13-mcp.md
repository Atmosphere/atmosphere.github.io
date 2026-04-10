---
title: "MCP Server"
description: "Expose tools, resources, and prompts to AI agents with @McpTool, @McpResource, @McpPrompt"
sidebar:
  order: 13
---

The Model Context Protocol (MCP) is an open standard that lets AI agents (Claude Desktop, VS Code Copilot, Cursor, etc.) discover and call tools, read resources, and use prompt templates from external servers. Atmosphere's `atmosphere-mcp` module lets you build an MCP server by adding four annotations to any Spring bean -- no servlet wiring, no protocol code, no external SDK.

`atmosphere-mcp` is a **self-contained MCP protocol implementation**. It speaks the MCP 2025-03-26 JSON-RPC wire protocol directly on top of Atmosphere's transport layer, so your server is automatically reachable over Streamable HTTP, WebSocket, and SSE with no additional dependencies.

**Module:** `atmosphere-mcp`
**Package:** `org.atmosphere.mcp`

## What you'll build

In this chapter you'll take the `spring-boot-mcp-server` sample and walk through how it exposes live chat administration tools to AI agents. By the end, an MCP client like Claude Desktop will be able to list connected users, broadcast messages to the chat, and read server status -- all through the standard MCP protocol.

## Dependencies

Add the MCP module and the Atmosphere Spring Boot starter. The `atmosphere-agent` module is what scans for your annotated class and registers the MCP endpoint:

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

<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-mcp</artifactId>
    <version>${project.version}</version>
</dependency>
```

That's the entire dependency setup. There is no `@McpServer` annotation, no `McpServerProcessor` to register, and no servlet filter to configure. The Spring Boot starter auto-configures the `AtmosphereServlet`, the agent processor discovers your annotated class at startup, and the MCP endpoint is registered on Atmosphere's transport layer automatically.

## The four annotations

`atmosphere-mcp` ships exactly four annotations. You will not find an `@McpServer` class-level annotation anywhere in the codebase -- class-level wiring is handled by `@Agent` from the `atmosphere-agent` module.

| Annotation | Target | Purpose |
|-----------|--------|---------|
| `@McpTool` | Method | Exposes a method as a callable tool (`tools/call`) |
| `@McpResource` | Method | Exposes a method as a read-only resource (`resources/read`) |
| `@McpPrompt` | Method | Exposes a method as a prompt template (`prompts/get`) |
| `@McpParam` | Parameter | Annotates parameters with name, description, and required flag |

The class itself is marked with `@Agent`, which tells the agent processor to scan the class and wire up any `@McpTool`, `@McpResource`, or `@McpPrompt` methods it finds.

## Step 1 -- Declare the agent class

Create a Spring bean annotated with `@Agent`. Set `endpoint` to the MCP path you want to expose and `headless = true` to indicate there is no `@Prompt` method or WebSocket UI -- this is a pure MCP service:

```java
package com.example.mcp;

import org.atmosphere.agent.annotation.Agent;
import org.springframework.stereotype.Component;

@Component
@Agent(name = "atmosphere-demo",
       version = "1.0.0",
       endpoint = "/atmosphere/mcp",
       headless = true)
public class DemoMcpServer {
    // tools, resources, and prompts go here
}
```

Key points:

- `name` is reported to MCP clients during the `initialize` handshake.
- `endpoint` is the HTTP/WebSocket path clients connect to. When the endpoint ends in `/mcp`, the agent processor registers the MCP handler at exactly that path; otherwise it defaults to `/atmosphere/agent/{name}/mcp`.
- `headless = true` forces "protocol-only" mode: no `@Prompt` method is required and no chat UI is registered.

## Step 2 -- Add a tool

A tool is any method marked with `@McpTool`. The return value is serialized to JSON and sent back to the AI agent. Parameters use `@McpParam` to declare their name, description, and whether they are required:

```java
import org.atmosphere.mcp.annotation.McpTool;
import org.atmosphere.mcp.annotation.McpParam;

import java.util.List;
import java.util.Map;

@McpTool(name = "list_users",
         description = "List all users currently connected to the chat")
public List<Map<String, String>> listUsers() {
    var broadcaster = chatBroadcaster();
    if (broadcaster == null) {
        return List.of(Map.of("error", "No chat broadcaster active"));
    }
    return broadcaster.getAtmosphereResources().stream()
            .map(r -> Map.of(
                    "uuid", r.uuid(),
                    "transport", r.transport().name()))
            .toList();
}

@McpTool(name = "broadcast_message",
         description = "Send a message to all connected chat users")
public Map<String, Object> broadcastMessage(
        @McpParam(name = "message",
                  description = "The message text to broadcast") String message,
        @McpParam(name = "author",
                  description = "Author name",
                  required = false) String author) {
    var broadcaster = chatBroadcaster();
    var text = (author != null ? author : "MCP Admin") + ": " + message;
    broadcaster.broadcast(text);
    return Map.of("status", "sent",
                  "recipients", broadcaster.getAtmosphereResources().size());
}
```

Tool methods can return any serializable type -- `String`, `Map`, `List`, records, or domain objects. The MCP runtime serializes them to JSON via Jackson.

## Step 3 -- Add a resource

Resources are read-only data exposed at a URI. AI agents call `resources/read` with the URI to fetch the content:

```java
import org.atmosphere.mcp.annotation.McpResource;
import java.time.Instant;
import java.util.LinkedHashMap;

@McpResource(uri = "atmosphere://server/status",
             name = "Server Status",
             description = "Current server status and uptime",
             mimeType = "application/json")
public String serverStatus() {
    var status = new LinkedHashMap<String, Object>();
    status.put("status", "running");
    status.put("timestamp", Instant.now().toString());
    status.put("connectedUsers", config.resourcesFactory().findAll().size());
    return mapper.writeValueAsString(status);
}
```

The `uri` is the stable identifier clients request. `mimeType` defaults to `text/plain`; set it explicitly when returning JSON, Markdown, or binary data.

## Step 4 -- Add a prompt template

Prompt templates return a list of `McpMessage` objects that the AI agent can inject into its own conversation. Use `McpMessage.system()` and `McpMessage.user()` to build the template:

```java
import org.atmosphere.mcp.annotation.McpPrompt;
import org.atmosphere.mcp.protocol.McpMessage;

import java.util.List;

@McpPrompt(name = "chat_summary",
           description = "Summarize current chat status")
public List<McpMessage> chatSummary() {
    var broadcaster = chatBroadcaster();
    var userCount = broadcaster != null
            ? broadcaster.getAtmosphereResources().size() : 0;
    return List.of(
            McpMessage.system("You are a chat moderator assistant."),
            McpMessage.user("There are currently " + userCount
                    + " users connected. Summarize the chat status.")
    );
}
```

## Step 5 -- Access the Atmosphere runtime from your tools

Because `DemoMcpServer` is a Spring bean, you can inject any Spring dependency. Atmosphere itself injects `AtmosphereConfig` through the framework's own injection when the class is wired in by the agent processor:

```java
import jakarta.inject.Inject;
import org.atmosphere.cpr.AtmosphereConfig;
import org.atmosphere.cpr.Broadcaster;

@Inject
private AtmosphereConfig config;

private Broadcaster chatBroadcaster() {
    try {
        return config.getBroadcasterFactory().lookup("/atmosphere/chat", false);
    } catch (Exception e) {
        return null;
    }
}
```

From there, `config.getBroadcasterFactory()` and `config.resourcesFactory()` give tools full access to live connections, broadcasters, and the framework state. This is the key insight of Atmosphere's MCP module: **your AI tools run in the same JVM as your real-time transport, so they can query and push to live WebSocket/SSE clients directly.**

### Injectable framework parameters

`@McpTool` methods can also declare framework types as method parameters. The runtime auto-injects them at invocation time and excludes them from the JSON schema advertised to the AI agent:

| Parameter type | What's injected | Notes |
|----------------|-----------------|-------|
| `Broadcaster` | The broadcaster for the `topic` argument | Requires a `@McpParam(name = "topic")` argument on the method |
| `StreamingSession` | A `BroadcasterStreamingSession` wrapping the topic's broadcaster | Requires `atmosphere-ai` on the classpath |
| `AtmosphereConfig` | The framework's `AtmosphereConfig` | Always available |
| `BroadcasterFactory` | The framework's `BroadcasterFactory` | Always available |
| `AtmosphereFramework` | The framework instance | Always available |

Example -- a tool that pushes a message to any chat topic the agent specifies:

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

When an AI agent calls this tool with `{"message": "hello", "topic": "/chat"}`, the runtime looks up the `/chat` broadcaster, injects it as `broadcaster`, and the message is delivered to every subscribed WebSocket, SSE, and long-polling client.

## Step 6 -- Configure the application

The Spring Boot starter reads a single Atmosphere-specific property so the framework knows which packages to scan for annotated classes:

```properties
# src/main/resources/application.properties
server.port=8083

# Tell Atmosphere to scan the MCP runtime package plus your own
atmosphere.packages=org.atmosphere.mcp,com.example.mcp
```

No other configuration is required. `atmosphere.enabled` defaults to `true`, and the MCP endpoint is registered automatically when the agent processor sees your `@Agent` class.

## Step 7 -- Run it

```bash
./mvnw spring-boot:run
```

The MCP endpoint is now live at `http://localhost:8083/atmosphere/mcp`. Three transports are available on the same URL:

| Transport | How to connect |
|-----------|---------------|
| Streamable HTTP (MCP 2025-03-26) | `POST http://localhost:8083/atmosphere/mcp` |
| WebSocket | `ws://localhost:8083/atmosphere/mcp` |
| SSE | `GET http://localhost:8083/atmosphere/mcp` |

The transport is chosen by the client based on the request method and `Accept` header. Agents get automatic reconnection, heartbeats, and transport fallback from Atmosphere's transport layer.

## Step 8 -- Call a tool with curl

Use the Streamable HTTP transport to initialize a session and invoke a tool:

```bash
# Initialize the session
curl -s -X POST http://localhost:8083/atmosphere/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2025-03-26",
                 "clientInfo":{"name":"curl","version":"1.0"}}}'

# List the tools the server advertises
curl -s -X POST http://localhost:8083/atmosphere/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Call list_users
curl -s -X POST http://localhost:8083/atmosphere/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"list_users","arguments":{}}}'
```

The server responds with JSON-RPC replies; the `initialize` response includes an `Mcp-Session-Id` header that the MCP spec encourages clients to echo back on subsequent requests.

## Connecting AI clients

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "atmosphere-demo": {
      "url": "http://localhost:8083/atmosphere/mcp"
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "atmosphere-demo": {
      "url": "http://localhost:8083/atmosphere/mcp"
    }
  }
}
```

### Cursor

Add to Cursor Settings -> MCP Servers the same URL-based configuration.

### stdio bridge

For clients that only support stdio, build the bridge JAR and point the client at it:

```bash
./mvnw package -Pstdio-bridge -DskipTests -pl modules/mcp
```

```json
{
  "mcpServers": {
    "atmosphere-demo": {
      "command": "java",
      "args": ["-jar", "path/to/atmosphere-mcp-stdio-bridge.jar",
               "http://localhost:8083/atmosphere/mcp"]
    }
  }
}
```

The bridge reads JSON-RPC messages from stdin, POSTs them to the Streamable HTTP endpoint, and writes responses to stdout.

## Programmatic registration

For tools built at runtime (plugin systems, user-defined macros, feature flags), you can skip annotations and register handlers programmatically against `McpRegistry`:

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

registry.registerPrompt("welcome", "Welcome message", List.of(),
    args -> List.of(
        McpMessage.system("You are a friendly assistant."),
        McpMessage.user("Welcome the user warmly.")
    )
);
```

Annotation-based and programmatic registrations coexist: agents see all of them in a single `tools/list` response.

## Bidirectional tool invocation

Most MCP servers are request/response from client to server. Atmosphere adds a reverse channel: `BiDirectionalToolBridge` lets the **server call tools on the connected client** -- typically a JavaScript function in the user's browser -- and asynchronously receive the result.

```java
var bridge = new BiDirectionalToolBridge();  // 30-second default timeout

CompletableFuture<String> result = bridge.callClientTool(
        resource, "getLocation", Map.of("highAccuracy", true));

result.thenAccept(location -> logger.info("Client location: {}", location));
```

On the wire, the server sends:

```json
{"type":"tool_call","id":"uuid","name":"getLocation","args":{"highAccuracy":true}}
```

And the client replies with:

```json
{"id":"uuid","result":"40.7128,-74.0060"}
```

To receive those client responses, register a `ToolResponseHandler` on the framework. This is the one bit of wiring that is not automatic:

```java
framework.addAtmosphereHandler("/_mcp/tool-response",
        new ToolResponseHandler(bridge));
```

Typical use cases: asking the browser for geolocation or local storage, requesting user confirmation before an admin action, or offloading work (image processing in a Web Worker) to the client.

## Observability

If `opentelemetry-api` is on the classpath, every `tools/call`, `resources/read`, and `prompts/get` invocation is wrapped in an OpenTelemetry trace span. The Spring Boot starter auto-configures `McpTracing` when an `OpenTelemetry` bean is present. Span attributes include `mcp.tool.name`, `mcp.tool.type`, `mcp.tool.arg_count`, and `mcp.tool.error`. See the [Observability](/docs/tutorial/18-observability/) chapter for the full setup.

## Next steps

- **Working sample**: `samples/spring-boot-mcp-server/` is the complete `DemoMcpServer` shown in this chapter, including a React frontend where human users chat in real time while AI agents connect via MCP to moderate them.
- **Reference**: [`reference/mcp`](/docs/reference/mcp/) -- the annotations, auto-configuration, injectable parameters, and observability attributes in one page.
- **Related**: [`tutorial/10-ai-tools`](/docs/tutorial/10-ai-tools/) -- how `@AiTool` methods on `@AiEndpoint` classes are automatically bridged into the MCP registry.
