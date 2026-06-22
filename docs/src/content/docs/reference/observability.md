---
title: "Observability"
description: "Micrometer metrics, OpenTelemetry tracing, backpressure"
---

# Observability

Atmosphere provides built-in support for Micrometer metrics, OpenTelemetry tracing, backpressure management, and cache configuration.

## Micrometer Metrics

```java
MeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
AtmosphereMetrics metrics = AtmosphereMetrics.install(framework, registry);
metrics.instrumentRoomManager(roomManager);
```

| Metric | Type | Description |
|--------|------|-------------|
| `atmosphere.connections.active` | Gauge | Active connections |
| `atmosphere.broadcasters.active` | Gauge | Active broadcasters |
| `atmosphere.connections.total` | Counter | Total connections opened |
| `atmosphere.messages.broadcast` | Counter | Messages broadcast |
| `atmosphere.broadcast.timer` | Timer | Broadcast latency |
| `atmosphere.rooms.active` | Gauge | Active rooms |
| `atmosphere.rooms.members` | Gauge | Members per room (tagged) |

With the Spring Boot starter, metrics are auto-configured when `micrometer-core` and `MeterRegistry` are on the classpath.

## OpenTelemetry Tracing

```java
framework.interceptor(new AtmosphereTracing(GlobalOpenTelemetry.get()));
```

Creates spans for every request with the following attributes:

| Attribute | Description |
|-----------|-------------|
| `atmosphere.resource.uuid` | Resource UUID |
| `atmosphere.transport` | Transport type (WEBSOCKET, SSE, LONG_POLLING) |
| `atmosphere.action` | Action result (CONTINUE, SUSPEND, RESUME) |
| `atmosphere.broadcaster` | Broadcaster ID |
| `atmosphere.room` | Room name (if applicable) |

With the Spring Boot starter, tracing is auto-configured when an `OpenTelemetry` bean is present. Disable with `atmosphere.tracing.enabled=false`.

### OpenTelemetry GenAI semantic conventions

When `atmosphere-ai` is in use, Atmosphere emits the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) — a spec OpenTelemetry still marks **experimental** — **additively** — the existing `ai.tokens.*` metadata and the `atmosphere.ai.*` Micrometer series are emitted unchanged alongside the `gen_ai.*` signals, so token and latency data lands in Langfuse / LangSmith / Grafana GenAI dashboards with no per-metric remapping.

> **OpenTelemetry spec status.** The OpenTelemetry GenAI semantic convention is not stable; attribute and metric names may change in a future OTel release. (Atmosphere's emitter is production code — only the upstream convention it follows is experimental.) Treat the `gen_ai.*` signals below as additive and subject to change, and keep building dashboards on the stable `atmosphere.ai.*` series where you need long-term stability.

**Span attributes.** When `io.opentelemetry.api` is on the classpath *and* a live span is active (an `AtmosphereTracing` SERVER span, for example), `GenAiTracer` tags that **current** span with the OpenTelemetry GenAI span attributes. Emission is via a reflection-based helper with no hard OpenTelemetry dependency — absent OTel, or absent a current span, it is a no-op and no orphan span is ever created.

| Span attribute | Type | Source |
|----------------|------|--------|
| `gen_ai.usage.input_tokens` | long | `TokenUsage.input()` |
| `gen_ai.usage.output_tokens` | long | `TokenUsage.output()` |
| `gen_ai.usage.total_tokens` | long | `TokenUsage.total()` |
| `gen_ai.request.model` | string | the request model |
| `gen_ai.response.model` | string | `TokenUsage.model()` — **omitted** when the runtime did not report a model (Runtime Truth: no placeholder) |
| `gen_ai.operation.name` | string | `chat` |
| `gen_ai.provider.name` | string | the resolved `AgentRuntime.name()` (the real runtime name — e.g. `built-in`, `anthropic` — never a hardcoded value) |

Attributes are written only when `TokenUsage.hasCounts()` is true and a valid current span exists.

**Metrics.** Alongside the `atmosphere.ai.*` series, `MicrometerAiMetrics` also emits the GenAI convention instruments. This applies to **any** runtime that reports usage through `StreamingSession.usage(TokenUsage)` — the capture point is the pipeline-level `MetricsCapturingSession`, not a single adapter.

| Metric | Type | Description |
|--------|------|-------------|
| `gen_ai.client.token.usage` | Distribution | Token counts, split by `gen_ai.token.type` (`input` / `output`) |
| `gen_ai.client.operation.duration` | Timer | Full operation wall-clock time |

These instruments carry the `gen_ai.operation.name`, `gen_ai.provider.name`, and `gen_ai.request.model` attributes; `gen_ai.provider.name` is the resolved runtime name (`AgentRuntime.name()`), and `gen_ai.response.model` is added when the runtime reported one.

### MCP Tracing

When `atmosphere-mcp` is on the classpath, `McpTracing` adds spans for tool, resource, and prompt invocations:

| Attribute | Description |
|-----------|-------------|
| `mcp.tool.name` | Tool/resource/prompt name |
| `mcp.tool.type` | `"tool"`, `"resource"`, or `"prompt"` |
| `mcp.tool.arg_count` | Number of arguments |
| `mcp.tool.error` | `true` if invocation failed |

## Backpressure

```java
framework.interceptor(new BackpressureInterceptor());
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `org.atmosphere.backpressure.highWaterMark` | `1000` | Max pending messages per client |
| `org.atmosphere.backpressure.policy` | `drop-oldest` | `drop-oldest`, `drop-newest`, or `disconnect` |

## Cache Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `org.atmosphere.cache.UUIDBroadcasterCache.maxPerClient` | `1000` | Max cached messages per client |
| `org.atmosphere.cache.UUIDBroadcasterCache.messageTTL` | `300` | Per-message TTL in seconds |
| `org.atmosphere.cache.UUIDBroadcasterCache.maxTotal` | `100000` | Global cache size limit |

## Samples

- [Spring Boot OTel Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-otel-chat) -- OpenTelemetry tracing with Jaeger
- [Spring Boot Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-chat) -- Micrometer metrics and Actuator health

## See Also

- [Core Runtime](core.md)
- [Spring Boot Integration](spring-boot.md) -- auto-configured observability
- [MCP Server](mcp.md) -- MCP tracing
