---
title: "Spring Boot"
description: "Auto-configuration for Spring Boot 4.0+"
---

# Spring Boot Integration

Auto-configuration for running Atmosphere on Spring Boot 4.0.5 (Spring Framework 6.2.8). Registers `AtmosphereServlet`, wires Spring DI into Atmosphere's object factory, and exposes `AtmosphereFramework` and `RoomManager` as Spring beans.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-spring-boot-starter</artifactId>
    <version>${project.version}</version>
</dependency>
```

### Spring Boot 4.0 modularization

Spring Boot 4.0 splits several modules into separate artifacts. When you depend on features that used to live in the main `spring-boot` jar, you may need to add them explicitly:

| Feature | Artifact |
|---------|----------|
| Servlet support | `org.springframework.boot:spring-boot-servlet` |
| Embedded web server | `org.springframework.boot:spring-boot-web-server` |
| Actuator health indicator | `org.springframework.boot:spring-boot-health` |

The Atmosphere starter depends on `spring-boot-servlet` transitively. Add `spring-boot-health` explicitly if you want the `AtmosphereHealthIndicator` to be picked up.

### SLF4J / Logback override

Spring Boot 4.0 ships with SLF4J 2.x. If your build inherits from a parent POM that pins an older SLF4J 1.x or Logback 1.2.x, you must override both in `<dependencies>` (not just `dependencyManagement`) for the starter to work.

## Quick Start

### application.yml

```yaml
atmosphere:
  packages: com.example.chat
```

### Chat.java

```java
@ManagedService(path = "/atmosphere/chat")
public class Chat {

    @Inject
    private BroadcasterFactory factory;

    @Inject
    private AtmosphereResource r;

    @Ready
    public void onReady() { }

    @Disconnect
    public void onDisconnect() { }

    @Message(encoders = {JacksonEncoder.class}, decoders = {JacksonDecoder.class})
    public Message onMessage(Message message) {
        return message;
    }
}
```

No additional configuration is needed beyond a standard `@SpringBootApplication` class.

## Configuration Properties

All properties are under the `atmosphere.*` prefix:

| Property | Default | Description |
|----------|---------|-------------|
| `atmosphere.packages` | (none) | Comma-separated packages to scan for Atmosphere annotations |
| `atmosphere.servlet-path` | `/atmosphere/*` | Servlet URL mapping |
| `atmosphere.session-support` | `false` | Enable HTTP session support |
| `atmosphere.websocket-support` | (auto) | Explicitly enable/disable WebSocket |
| `atmosphere.broadcaster-class` | (default) | Custom `Broadcaster` implementation FQCN |
| `atmosphere.broadcaster-cache-class` | (default) | Custom `BroadcasterCache` implementation FQCN |
| `atmosphere.heartbeat-interval` | (default) | Server heartbeat frequency (Duration string, e.g. `30s`) |
| `atmosphere.order` | `0` | Servlet load-on-startup order |
| `atmosphere.init-params` | (none) | Map of any `ApplicationConfig` key/value |

## Auto-Configured Beans

- `AtmosphereServlet` -- the servlet instance
- `AtmosphereFramework` -- the framework for programmatic configuration
- `RoomManager` -- the room API for presence and message history
- `AtmosphereHealthIndicator` -- Actuator health check (when `spring-boot-health` is on the classpath)
- `AtmosphereAiAutoConfiguration` -- scans for `@AiEndpoint` / `@Agent` beans and wires the resolved `AgentRuntime` (built-in, Spring AI, LangChain4j, ADK, Embabel, or Koog)
- `AtmosphereAdminAutoConfiguration` / `AtmosphereActuatorAutoConfiguration` / `AtmosphereAuthAutoConfiguration` -- admin console, actuator metrics, and basic auth (opt-in via `atmosphere.admin.*`, `atmosphere.actuator.*`, `atmosphere.auth.*`)

## AI Auto-Configuration

When `atmosphere-ai` is on the classpath, the starter auto-discovers the best available `AgentRuntime` via `ServiceLoader` (LangChain4j, Spring AI, ADK, Embabel, Koog, or the built-in OpenAI-compatible client) and scans for `@AiEndpoint`/`@Agent` beans.

```yaml
atmosphere:
  ai:
    mode: remote            # remote | local
    model: gemini-2.5-flash
    base-url:               # optional, auto-derived from model
    api-key: ${GEMINI_API_KEY}
```

Environment variables `LLM_MODE`, `LLM_MODEL`, `LLM_BASE_URL`, and `LLM_API_KEY` override these properties when the starter runs outside Spring configuration. See the [AI reference](../reference/ai/) for the full `AgentRuntime` SPI.

## gRPC Transport

The starter can launch a gRPC server alongside the servlet container when `atmosphere-grpc` is on the classpath:

```yaml
atmosphere:
  grpc:
    enabled: true
    port: 9090
    enable-reflection: true
```

| Property | Default | Description |
|----------|---------|-------------|
| `atmosphere.grpc.enabled` | `false` | Enable gRPC transport server |
| `atmosphere.grpc.port` | `9090` | gRPC server port |
| `atmosphere.grpc.enable-reflection` | `true` | Enable gRPC server reflection |

Define a `GrpcHandler` bean to handle gRPC events:

```java
@Bean
public GrpcHandler grpcHandler() {
    return new GrpcHandlerAdapter() {
        @Override
        public void onOpen(GrpcChannel channel) {
            log.info("gRPC client connected: {}", channel.uuid());
        }
        @Override
        public void onMessage(GrpcChannel channel, String message) {
            log.info("gRPC message: {}", message);
        }
    };
}
```

## Observability

### OpenTelemetry Tracing (Auto-Configured)

Add `opentelemetry-api` to your classpath and provide an `OpenTelemetry` bean -- the starter automatically registers `AtmosphereTracing`:

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
```

Every Atmosphere request generates a trace span with transport, resource UUID, broadcaster, and action attributes. Disable with `atmosphere.tracing.enabled=false`.

When `atmosphere-mcp` is also on the classpath, an `McpTracing` bean is auto-created for MCP tool/resource/prompt call tracing.

### Micrometer Metrics (Auto-Configured)

When `micrometer-core` and `MeterRegistry` are on the classpath, the starter registers `atmosphere.connections`, `atmosphere.messages`, and `atmosphere.broadcasters` gauges.

## GraalVM Native Image

The starter includes `AtmosphereRuntimeHints` for native image support:

```bash
cd samples/spring-boot-chat && ../../mvnw -Pnative package
./target/atmosphere-spring-boot-chat-*
```

Requires GraalVM JDK 21+ (Spring Boot 4.0.5 / Spring Framework 6.2.8 baseline).

## `@AiEndpoint` annotation surfaces (new in 4.0.36)

Spring Boot's `@AiEndpoint` annotation gained two declarative attributes in 4.0.36 that let you configure prompt caching and per-request retry without touching `AgentExecutionContext` directly.

### `@AiEndpoint.promptCache` — prompt caching policy

Attach a `CacheHint.CachePolicy` to every request produced by an endpoint. The pipeline seeds each request's `CacheHint` before dispatching to the runtime — Spring AI, LangChain4j, and the Built-in OpenAI path emit `prompt_cache_key` on the wire, and the pipeline-level `ResponseCache` also honors the hint regardless of runtime.

```java
@AiEndpoint(
    path = "/ai/chat",
    systemPrompt = "You are a helpful assistant",
    promptCache = CacheHint.CachePolicy.CONSERVATIVE
)
public class AiChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);
    }
}
```

Three policy values:

- `CachePolicy.NONE` (default) — no caching hint
- `CachePolicy.CONSERVATIVE` — short TTL (30 min), only cache if the prefix is identical
- `CachePolicy.AGGRESSIVE` — longer TTL (24 h), cache any semantically similar prefix

The policy is endpoint-scoped. To set the cache hint per request, use `context.withCacheHint()` directly.

### `@AiEndpoint.retry` — per-request retry policy

Override the client-level retry policy on a per-endpoint basis. Useful when a particular endpoint needs tighter or looser semantics than the global default (for example, a strict endpoint that must fail fast, or a best-effort background endpoint that can retry aggressively).

```java
@AiEndpoint(
    path = "/ai/strict",
    systemPrompt = "You are a mission-critical assistant",
    retry = @Retry(maxRetries = 0)
)
public class StrictChat {
    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // fails fast — no retries on transient errors
    }
}

@AiEndpoint(
    path = "/ai/background",
    retry = @Retry(maxRetries = 5, initialDelayMs = 2000, backoffMultiplier = 2.0)
)
public class BackgroundChat {
    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);  // retries up to 5 times with exponential backoff
    }
}
```

`@Retry` attributes:

- `maxRetries` — sentinel `-1` means "inherit client-level default", 0 disables retries, 1+ retries
- `initialDelayMs` — base delay before the first retry (default `1000`)
- `maxDelayMs` — cap on exponential backoff (default `30000`)
- `backoffMultiplier` — exponential factor (default `2.0`)

**Runtime coverage:** all eight framework adapters declare `PER_REQUEST_RETRY` honestly as of 4.0.43 (commit `374631e7`) — `AbstractAgentRuntime.executeWithOuterRetry` wraps each adapter's dispatch in a retry loop respecting `context.retryPolicy(...)`, on top of each runtime's own native retry layer (Spring Retry, LC4j `RetryUtils`, ADK `HttpClient`, Koog `CallRetryPolicy`, SK `OpenAIAsyncClient`). The Built-in runtime additionally threads `context.retryPolicy()` into `OpenAiCompatibleClient.sendWithRetry` as a native override. See the [per-runtime capability matrix](../../tutorial/11-ai-adapters/#per-runtime-capability-matrix) for the full breakdown.

## Samples

- [Spring Boot Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-chat) -- rooms, presence, REST API, Micrometer metrics, Actuator health
- [Spring Boot AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-chat) -- built-in AI client
- [Spring Boot MCP Server](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-mcp-server) -- MCP tools, resources, prompts
- [Spring Boot OTel Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-otel-chat) -- OpenTelemetry tracing with Jaeger

## See Also

- [Core Runtime](../reference/core/)
- [AI Integration](../reference/ai/)
- [gRPC Transport](../reference/grpc/)
- [Observability](../reference/observability/)
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/spring-boot-starter)
