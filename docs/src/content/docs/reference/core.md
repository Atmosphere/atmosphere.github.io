---
title: "Core Runtime"
description: "Broadcaster, AtmosphereResource, @ManagedService, transport negotiation"
---

# Core Runtime

The core framework for building real-time web applications in Java. Provides a portable, annotation-driven programming model that runs on any Servlet 6.0+ container with automatic transport negotiation.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-runtime</artifactId>
    <version>${project.version}</version>
</dependency>
```

Maven 3.5+ no longer resolves `<version>LATEST</version>` for regular dependencies; pin an explicit version. A `<properties>` placeholder keeps cross-module upgrades to a single line.

## Key Concepts

**Broadcaster** -- a named pub/sub channel. Call `broadcaster.broadcast(message)` and every subscribed resource receives it. Broadcasters support caching, filtering, and clustering (Redis, Kafka) out of the box.

**AtmosphereResource** -- a single connection. It wraps the underlying transport (WebSocket frame, SSE event stream, HTTP response, gRPC stream) behind a uniform API. Resources subscribe to Broadcasters.

**Transport** -- the wire protocol. Atmosphere ships with 5 transports: WebTransport/HTTP3, WebSocket, SSE, Long-Polling, and gRPC. The transport is selected per-connection. Fallback is single-level and client-driven: when the primary fails, the client switches to its configured `fallbackTransport` (one hop), not an automatic WebSocket → SSE → Long-Polling cascade. The realized + tested fallback today is **WebTransport → WebSocket**; other one-hop pairs work if both ends support them. MCP is a protocol that rides on top of these transports (typically WebSocket, SSE, or Streamable HTTP), not a transport itself.

## Quick Start

```java
@ManagedService(path = "/chat")
public class Chat {

    @Inject
    private BroadcasterFactory factory;

    @Inject
    private AtmosphereResource r;

    @Ready
    public void onReady() {
        // client connected
    }

    @Disconnect
    public void onDisconnect() {
        // client left
    }

    @Message(encoders = {JacksonEncoder.class}, decoders = {JacksonDecoder.class})
    public Message onMessage(Message message) {
        return message; // broadcasts to all subscribers
    }
}
```

## Annotations

| Annotation | Target | Description |
|-----------|--------|-------------|
| `@ManagedService` | Class | Marks a class as a managed endpoint with a path |
| `@Ready` | Method | Called when a client connects |
| `@Disconnect` | Method | Called when a client disconnects |
| `@Message` | Method | Called when a message is received; return value is broadcast |
| `@Heartbeat` | Method | Called on heartbeat events |
| `@Resume` | Method | Called when a suspended connection resumes |

## Servlet Configuration

Register `AtmosphereServlet` in `web.xml` or programmatically:

```xml
<servlet>
    <servlet-class>org.atmosphere.cpr.AtmosphereServlet</servlet-class>
    <init-param>
        <param-name>org.atmosphere.cpr.packages</param-name>
        <param-value>com.example.chat</param-value>
    </init-param>
    <load-on-startup>0</load-on-startup>
    <async-supported>true</async-supported>
</servlet>
```

`org.atmosphere.cpr.packages` drives a runtime classpath scan, which a native image cannot perform -- see [GraalVM Native Image](#graalvm-native-image).

## Virtual Threads

JDK 21 virtual threads are used by default. The `ExecutorsFactory` creates a `newVirtualThreadPerTaskExecutor()` and `DefaultBroadcaster` uses `ReentrantLock` (not `synchronized`) to avoid pinning.

Opt out with:

```
org.atmosphere.useVirtualThreads=false
```

## GraalVM Native Image

`atmosphere-runtime` ships GraalVM reachability metadata inside the jar, at `META-INF/native-image/org.atmosphere/atmosphere-runtime/reachability-metadata.json`. GraalVM reads that path automatically, so the framework types Atmosphere loads by name -- broadcaster caches such as `org.atmosphere.cache.UUIDBroadcasterCache`, the default `Broadcaster` and factory implementations, the `ServiceLoader` files behind injection -- are registered for reflection with no integration module and no configuration.

Classes your own code names in an annotation attribute are a separate problem: `@Message(encoders = ..., decoders = ...)` most visibly, but also broadcasters, filters and interceptors. The framework cannot enumerate those, so they are collected from the annotation attributes at build time -- by the Spring Boot starter's AOT processor, and by the Quarkus deployment step.

### What CI verifies

`.github/workflows/native-image-ci.yml` builds two real native binaries (`samples/spring-boot-chat` and `samples/quarkus-chat`), starts each one, opens a long-polling connection to `/atmosphere/chat`, and asserts that the annotated `@Ready` method ran. The verified claim is exactly that: **a `@ManagedService` serves a long-polling connection under Native Image, on the Spring Boot 4 starter and on the Quarkus extension.**

:::caution[Not verified under Native Image]
No job asserts the following, so do not assume a native binary provides them:

- WebSocket and SSE under native, and transport negotiation or fallback -- only long-polling is driven
- `@Message` encoder/decoder round-trips (the types are registered; the round-trip is not exercised)
- Rooms, `@RoomService`, presence, broadcast fan-out
- Injection beyond what `@Ready` requires
- The AI stack (`@AiEndpoint`, `@Agent`) -- no native job builds an AI sample

A green Native Image run means those two long-polling assertions passed. Read it as that, not as a general "Atmosphere supports GraalVM Native Image".
:::

### Declaring reflective types

A module declares what it loads by name by implementing `org.atmosphere.nativeimage.NativeImageMetadataProvider` and listing the implementation in `META-INF/services/org.atmosphere.nativeimage.NativeImageMetadataProvider`:

```java
public final class MyMetadataProvider implements NativeImageMetadataProvider {

    @Override
    public String name() {
        return "my-module";
    }

    @Override
    public Collection<String> reflectiveTypes() {
        return List.of("com.example.LoadedByName");
    }
}
```

Only `name()` has to be implemented -- `reflectiveTypes()`, `resourcePatterns()`, `isAvailable()` and `priority()` all have defaults. Types are declared as strings so a provider can name a type from an optional dependency without forcing that dependency onto the classpath.

`NativeImageMetadata.collect()` merges every provider it finds and feeds all three integrations -- `AtmosphereRuntimeHints` in the Spring Boot 4 and Spring Boot 3 starters, and the Quarkus deployment processor -- as well as the metadata generated into the jar. Registration is a union: no provider can suppress another's types. Today `atmosphere-runtime` is the only module shipping a provider file; the SPI exists so that a module adding a reflective lookup can declare it beside the code doing the lookup, rather than in a central list.

### Build-time annotation index

A runtime classpath scan has nothing to scan in a native image -- there are no `.class` files left -- which is why annotated endpoints went undetected there before an index existed. `org.atmosphere.nativeimage.AtmosphereAnnotationIndexProcessor` records the Atmosphere-annotated classes at compile time into `META-INF/atmosphere/annotated-classes.txt`, one index per artifact. It is a javac annotation processor auto-discovered from `atmosphere-runtime` on the compile classpath, so depending on the jar is the whole setup, in any build tool.

Reading that index back is done by the Spring Boot 4 starter, which discovers the **union** of the runtime scan and every index found on the classpath. A union rather than "index wins", on purpose: an index is per-artifact, and letting one short-circuit the scan lets a single jar hide every other jar's classes. The Quarkus extension indexes with Jandex at build time instead. The `org.atmosphere.cpr.packages` scan shown under [Servlet Configuration](#servlet-configuration) is the runtime scan, so it is a JVM mechanism -- a plain-servlet native image gets the reflection metadata above, but has no equivalent discovery path today.

See the [Spring Boot](/docs/integrations/spring-boot/) and [Quarkus](/docs/integrations/quarkus/) docs for framework-specific native image build instructions.

## Samples

- [WAR Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/chat) -- standard WAR deployment with `@ManagedService`
- [Embedded Jetty WebSocket Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/embedded-jetty-websocket-chat) -- programmatic Jetty with `@WebSocketHandlerService`

## See Also

- [Spring Boot Integration](/docs/integrations/spring-boot/)
- [Quarkus Integration](/docs/integrations/quarkus/)
- [Rooms & Presence](rooms.md)
- [Observability](observability.md)
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/cpr)
