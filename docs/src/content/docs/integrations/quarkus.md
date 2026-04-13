---
title: "Quarkus"
description: "Build-time processing for Quarkus 3.31.3+"
---

# Quarkus Integration

A Quarkus extension that integrates Atmosphere with Quarkus 3.31.3+. Provides build-time annotation scanning via Jandex, Arc CDI integration, and GraalVM native image support.

## Maven Coordinates

```xml
<properties>
    <atmosphere.version>4.0.36</atmosphere.version>
</properties>

<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-quarkus-extension</artifactId>
    <version>${atmosphere.version}</version>
</dependency>
```

The deployment artifact (`atmosphere-quarkus-extension-deployment`) is resolved automatically by Quarkus.

## Quick Start

### application.properties

```properties
quarkus.atmosphere.packages=com.example.chat
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

The extension auto-registers the Atmosphere servlet -- no `web.xml` or manual servlet registration needed. The same `@ManagedService` handler works across WAR, Spring Boot, and Quarkus -- only packaging and configuration differ.

## Configuration Properties

All properties are under the `quarkus.atmosphere.*` prefix:

| Property | Default | Description |
|----------|---------|-------------|
| `quarkus.atmosphere.packages` | (none) | Comma-separated packages to scan |
| `quarkus.atmosphere.servlet-path` | `/atmosphere/*` | Servlet URL mapping |
| `quarkus.atmosphere.session-support` | `false` | Enable HTTP session support |
| `quarkus.atmosphere.websocket-support` | (auto) | Explicitly enable/disable WebSocket transport |
| `quarkus.atmosphere.broadcaster-class` | (default) | Custom `Broadcaster` implementation |
| `quarkus.atmosphere.broadcaster-cache-class` | (default) | Custom `BroadcasterCache` implementation |
| `quarkus.atmosphere.load-on-startup` | `1` | Servlet load-on-startup order -- **must be > 0** |
| `quarkus.atmosphere.heartbeat-interval` | (default) | Heartbeat interval (Duration string, e.g. `30s`) |
| `quarkus.atmosphere.init-params` | (none) | Map of raw `ApplicationConfig` init params |

> **Note:** `load-on-startup` must be > 0. Quarkus skips servlet initialization when this value is <= 0, unlike the standard Servlet spec where >= 0 means "load on startup." See `modules/quarkus-extension/runtime/src/main/java/org/atmosphere/quarkus/runtime/AtmosphereConfig.java` for the full config schema.

## Running

```bash
mvn quarkus:dev                          # dev mode with live reload
mvn clean package && java -jar target/quarkus-app/quarkus-run.jar  # JVM
mvn clean package -Pnative               # native image
```

## GraalVM Native Image

```bash
cd samples/quarkus-chat && ../../mvnw clean package -Pnative
./target/atmosphere-quarkus-chat-*-runner
```

Requires GraalVM JDK 21+ or Mandrel. Use `-Dquarkus.native.container-build=true` to build without a local GraalVM installation.

## `@AiEndpoint` annotation surfaces (new in 4.0.36)

The `@AiEndpoint` annotation works identically across Spring Boot and Quarkus — both frameworks use the same `AiEndpointProcessor` to read the annotation's `promptCache` and `retry` attributes. In Quarkus the annotation processor runs at build time through the Atmosphere extension and wires the endpoint into the Undertow deployment.

```java
@AiEndpoint(
    path = "/ai/chat",
    systemPrompt = "You are a helpful assistant",
    promptCache = CacheHint.CachePolicy.CONSERVATIVE,
    retry = @Retry(maxRetries = 3, initialDelayMs = 1000)
)
public class AiChat {

    @Prompt
    public void onPrompt(String message, StreamingSession session) {
        session.stream(message);
    }
}
```

See [Spring Boot → `@AiEndpoint` annotation surfaces](spring-boot/#aiendpoint-annotation-surfaces-new-in-4036) for the full attribute reference. The only Quarkus-specific consideration:

- **`load-on-startup`** must be > 0 for the endpoint to register at boot time (Quarkus's `UndertowDeploymentRecorder` skips on `<= 0`, unlike the Servlet spec).

**Runtime coverage:** per-request retry is **Built-in only** in 4.0.36. Framework runtimes inherit their native retry layers. See the [per-runtime capability matrix](../../tutorial/11-ai-adapters/#per-runtime-capability-matrix).

## Samples

- [Quarkus Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/quarkus-chat) -- real-time chat with WebSocket and long-polling fallback

## See Also

- [Core Runtime](../reference/core/)
- [Spring Boot Integration](spring-boot/)
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/quarkus-extension)
