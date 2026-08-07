---
title: "Quarkus Integration"
description: "Run Atmosphere as a Quarkus extension with build-time annotation scanning and CDI injection"
sidebar:
  order: 15
---

The `atmosphere-quarkus-extension` module integrates Atmosphere with Quarkus 3.36.0. It uses Quarkus's build-time processing to scan annotations via Jandex (no runtime classpath scanning), registers the servlet via `ServletBuildItem`, and bridges Quarkus's Arc CDI container to Atmosphere's object factory.

The bundled Atmosphere Console UI gets the same `subtitle / endpoint / runtime / mode` payload it gets on Spring Boot, via the `AtmosphereConsoleInfoServlet` registered at build time alongside the core servlet (4.0.43+, commit `4be7c7f0ad`). Two new config keys mirror the Spring side:

```properties
quarkus.atmosphere.console-subtitle=Multi-client broadcast chat
quarkus.atmosphere.console-endpoint=/atmosphere/ai-chat
```

When blank, the servlet auto-detects the right endpoint (preferring `/atmosphere/ai-chat` when registered, then `/atmosphere/agent/*`, then any other `/atmosphere/*`) and picks a mode-aware default subtitle (`Multi-client broadcast chat` for `@ManagedService` chats, `Runtime: <name>` for `@AiEndpoint` / `@Agent` / `@Coordinator`). The Vue Console reads `mode` to swap empty-state copy and default subtitle.

## Dependencies

The extension is split into two artifacts following Quarkus conventions:

```xml
<!-- Runtime module (what your application depends on) -->
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-quarkus-extension</artifactId>
    <version>${project.version}</version>
</dependency>
```

The deployment module (`atmosphere-quarkus-extension-deployment`) is pulled in automatically at build time by Quarkus's extension mechanism.

## Configuration

All configuration uses the `quarkus.atmosphere` prefix, defined via `@ConfigMapping`:

| Property | Default | Description |
|----------|---------|-------------|
| `quarkus.atmosphere.servlet-path` | `/atmosphere/*` | URL pattern for the Atmosphere servlet |
| `quarkus.atmosphere.packages` | (none) | Comma-separated packages to scan for Atmosphere annotations |
| `quarkus.atmosphere.load-on-startup` | `1` | Servlet load-on-startup order. **Must be > 0.** |
| `quarkus.atmosphere.session-support` | `false` | Enable HTTP session support |
| `quarkus.atmosphere.broadcaster-class` | (none) | Custom `Broadcaster` implementation class name |
| `quarkus.atmosphere.broadcaster-cache-class` | (none) | Custom `BroadcasterCache` implementation class name |
| `quarkus.atmosphere.websocket-support` | (auto) | Explicitly enable/disable WebSocket support |
| `quarkus.atmosphere.heartbeat-interval-in-seconds` | (auto) | Heartbeat interval |
| `quarkus.atmosphere.init-params.*` | (none) | Additional Atmosphere init parameters |

The configuration is `BUILD_AND_RUN_TIME_FIXED`, meaning values are read at build time and baked into the application. This is required because the `@BuildStep` methods that produce `ServletBuildItem` run during the Quarkus build phase.

### Example application.properties

From the `quarkus-chat` sample:

```properties
quarkus.atmosphere.packages=org.atmosphere.samples.quarkus.chat
quarkus.log.category."org.atmosphere".level=DEBUG
```

## @ManagedService

The same `@ManagedService` annotation works identically in Quarkus:

```java
@ManagedService(path = "/atmosphere/chat",
                atmosphereConfig = MAX_INACTIVE + "=120000")
public class Chat {

    @Inject
    @Named("/atmosphere/chat")
    private Broadcaster broadcaster;

    @Inject
    private AtmosphereResource r;

    @Inject
    private AtmosphereResourceEvent event;

    @Heartbeat
    public void onHeartbeat(final AtmosphereResourceEvent event) {
        logger.trace("Heartbeat from {}", event.getResource());
    }

    @Ready
    public void onReady() {
        logger.info("Browser {} connected", r.uuid());
    }

    @Disconnect
    public void onDisconnect() {
        if (event.isCancelled()) {
            logger.info("Browser {} unexpectedly disconnected",
                event.getResource().uuid());
        } else if (event.isClosedByClient()) {
            logger.info("Browser {} closed the connection",
                event.getResource().uuid());
        }
    }

    @Message(encoders = {JacksonEncoder.class},
             decoders = {JacksonDecoder.class})
    public Message onMessage(Message message) {
        logger.info("{} just sent {}", message.getAuthor(), message.getMessage());
        return message;
    }
}
```

The `@Inject` annotations resolve through `QuarkusAtmosphereObjectFactory`, which delegates to Quarkus's Arc CDI container for application beans and to Atmosphere's own injection for framework objects (`AtmosphereResource`, `Broadcaster`, etc.).

## How the extension works

### Build-time processing (AtmosphereProcessor)

The `AtmosphereProcessor` (in the deployment module) runs `@BuildStep` methods during the Quarkus build:

1. **Feature registration**: Registers the `"atmosphere"` feature so `quarkus:info` lists it.

2. **Jandex indexing**: Adds `atmosphere-runtime` to the Jandex index via `IndexDependencyBuildItem`, so all Atmosphere annotations are discoverable at build time.

3. **Annotation scanning**: Scans the combined Jandex index for all Atmosphere annotations (`@ManagedService`, `@AtmosphereHandlerService`, `@BroadcasterFilterService`, `@RoomService`, etc.) and collects them into an `AtmosphereAnnotationsBuildItem`. This replaces the runtime classpath scanning that Atmosphere normally does.

4. **SCI suppression**: Suppresses both `AnnotationScanningServletContainerInitializer` and `ContainerInitializer` via `IgnoredServletContainerInitializerBuildItem`. The extension manages annotation scanning at build time via Jandex, and framework initialization via `QuarkusAtmosphereServlet`.

5. **Servlet registration**: Produces a `ServletBuildItem` for `QuarkusAtmosphereServlet` with the configured path, load-on-startup order, and init parameters.

6. **WebSocket endpoint registration**: Registers JSR-356 WebSocket endpoints with the Quarkus-managed `ServerWebSocketContainer` at `STATIC_INIT` time. This must happen before deployment is marked complete, since Quarkus's Undertow fork rejects `addEndpoint()` after deployment.

7. **Reflection registration**: Registers all discovered annotated classes for reflection, plus every type declared by a `NativeImageMetadataProvider` found on the build classpath — `AtmosphereProcessor` calls `org.atmosphere.nativeimage.NativeImageMetadata.collect(...)` and merges the providers instead of carrying its own transcription of a core-types list. The same step produces a `NativeImageResourceBuildItem` for each declared resource pattern, and logs the type and resource counts plus the contributing provider names at `INFO`. See [Native Image](#native-image) for what a native build of the sample is actually asserted to do, and what it is not.

8. **Encoder/Decoder registration**: Scans `@Message` and `@Ready` annotations for `encoders()` and `decoders()` arrays and registers those classes for reflection.

### Runtime components

| Class | Role |
|-------|------|
| `QuarkusAtmosphereServlet` | Extends `AtmosphereServlet` to inject the pre-scanned annotation map |
| `AtmosphereServletInstanceFactory` | Quarkus servlet instance factory |
| `QuarkusAtmosphereObjectFactory` | Bridges Arc CDI to Atmosphere's object factory |
| `QuarkusJSR356AsyncSupport` | Custom async support extending `Servlet30CometSupport` with `supportWebSocket() == true` |
| `LazyAtmosphereConfigurator` | Defers JSR-356 `ServerEndpointConfig.Configurator` setup until the framework is initialized |
| `AtmosphereRecorder` | Quarkus `@Recorder` for runtime-init operations |

### Why QuarkusJSR356AsyncSupport?

The standard `JSR356AsyncSupport` calls `container.addEndpoint()` in its constructor, which fails in Quarkus with error UT003017 ("Cannot add endpoint after deployment"). The Quarkus extension registers endpoints at `STATIC_INIT` time instead, and uses `QuarkusJSR356AsyncSupport` (which extends `Servlet30CometSupport` and returns `true` from `supportWebSocket()`) as a drop-in replacement.

## Critical: loadOnStartup must be > 0

Quarkus's `UndertowDeploymentRecorder` skips `setLoadOnStartup()` when the value is `<= 0`. Unlike the Servlet spec where `>= 0` means "load on startup", Quarkus requires a value **strictly greater than 0** for the servlet to initialize at startup. The default is `1`.

If you set `quarkus.atmosphere.load-on-startup=0` or a negative value, the Atmosphere servlet will **not** be initialized at startup, and no connections will be accepted.

## Dev mode

The extension supports Quarkus dev mode (`quarkus:dev`) with live reload. The `AtmosphereRecorder` registers a shutdown hook via `ShutdownContextBuildItem` that resets the `LazyAtmosphereConfigurator` before each reload cycle, ensuring a fresh `CountDownLatch` and framework reference.

## Differences from Spring Boot

| Aspect | Spring Boot | Quarkus |
|--------|------------|---------|
| Annotation scanning | Union of a runtime scan and a build-time index (Spring AOT / javac processor) | Build time (Jandex) — the index is not read |
| Config prefix | `atmosphere.*` | `quarkus.atmosphere.*` |
| Config binding | `@ConfigurationProperties` | `@ConfigMapping` + `@ConfigRoot` |
| Object factory | `SpringAtmosphereObjectFactory` | `QuarkusAtmosphereObjectFactory` |
| WebSocket registration | Handled by container | Explicit at `STATIC_INIT` |
| loadOnStartup | `0` works (Servlet spec) | Must be `> 0` (Quarkus quirk) |
| Config phase | Runtime | `BUILD_AND_RUN_TIME_FIXED` |
| SCI handling | Overridden via servlet context attribute | Suppressed via `IgnoredServletContainerInitializerBuildItem` |

## Native Image

Atmosphere resolves much of its own machinery by name — broadcaster caches,
interceptors, annotation processors, encoders — so ahead-of-time compilation
drops classes that nothing statically references. The extension registers those
classes at build time from three sources: the Jandex index (annotated classes,
plus any class named inside `@Message(encoders/decoders)` or `@Ready(encoders)`),
a short list of Quarkus-specific runtime classes
(`QuarkusAtmosphereObjectFactory`, `QuarkusAtmosphereServlet`,
`QuarkusJSR356AsyncSupport`, `LazyAtmosphereConfigurator`), and the
`NativeImageMetadataProvider` SPI described below.

Failures in this area are quiet rather than loud. A missing broadcaster-cache
hint makes `createBroadcaster` throw `ClassNotFoundException`, which
`ManagedServiceProcessor` catches and logs before carrying on — the process
starts, serves static content and answers a health probe, and every
`@ManagedService` endpoint simply never exists. That was a real bug:
`org.atmosphere.cache.UUIDBroadcasterCache`, `DefaultBroadcasterCache`,
`SessionBroadcasterCache` and `BoundedMemoryCache` are loaded by name and were
unregistered, which silently unregistered every annotated endpoint. Native
coverage claims therefore have to name the request that was driven and the
assertion that was made.

### What CI proves

Job `quarkus-native` in `.github/workflows/native-image-ci.yml` builds
`samples/quarkus-chat` into a native binary (Mandrel, container build), starts
it, and drives a single request:

```bash
curl "http://localhost:8080/atmosphere/chat?X-Atmosphere-tracking-id=0&X-Atmosphere-Framework=2.3&X-Atmosphere-Transport=long-polling&X-Cache-Date=0"
```

The job fails unless the application log then contains `connected (broadcaster:`,
a line only `Chat.onReady()` writes. Passing establishes, under a real native
image: `@ManagedService` discovery from the Jandex index, handler registration,
`Broadcaster` construction and therefore its by-name-loaded cache class,
`@Inject` of `AtmosphereResource` and a `@Named` `Broadcaster`, and `@Ready`
firing — over **long-polling**. A sibling job in the same workflow makes the
identical assertion against `samples/spring-boot-chat` on the Spring Boot 4
starter.

### What CI does not prove

No native lane covers anything below. None of it should be described as
native-verified until one does:

- **WebSocket** — the smoke test pins the transport to long-polling by hand.
- **SSE, transport negotiation and fallback.**
- **`@Message` round-trip.** Build step 8 above does register the sample's
  `JacksonEncoder` / `JacksonDecoder`, but the lane never POSTs a message, so
  the encode/decode path is compiled and never exercised.
- **Rooms / `@RoomService`, presence, broadcast fan-out, `@Disconnect`,
  `@Heartbeat`.**
- **The AI stack.** `samples/quarkus-ai-chat` has no native job and is not in
  the workflow's path filters, so `@AiEndpoint` and `@Agent` under Native Image
  are unproven.
- **Injection beyond what `@Ready` needs.**

### Contributing your own reflective types

`registerReflection` merges every `NativeImageMetadataProvider` found on the
build classpath, so a module — including an application module — declares the
classes it loads by name next to the code that loads them, instead of needing an
entry in a central list:

```java
package com.example.chat;

import java.util.Collection;
import java.util.List;
import org.atmosphere.nativeimage.NativeImageMetadataProvider;

public final class ExampleMetadataProvider implements NativeImageMetadataProvider {

    @Override
    public String name() {
        return "example-app";
    }

    @Override
    public Collection<String> reflectiveTypes() {
        return List.of("com.example.chat.CustomBroadcasterCache");
    }

    @Override
    public Collection<String> resourcePatterns() {
        return List.of("META-INF/services/com.example.chat.Plugin");
    }
}
```

Registered in
`src/main/resources/META-INF/services/org.atmosphere.nativeimage.NativeImageMetadataProvider`:

```
com.example.chat.ExampleMetadataProvider
```

`isAvailable()` (default `true`) lets a provider covering an optional dependency
exclude itself when that dependency is absent; `priority()` only orders the
emitted output. Collection is a union, so no provider can suppress another's
types. In this repository `atmosphere-runtime` is currently the only artifact
shipping providers (`CoreNativeImageMetadataProvider` and
`PoolNativeImageMetadataProvider`) — the SPI exists so that other modules and
applications can contribute without a change to this build step.

Those same providers generate
`META-INF/native-image/org.atmosphere/atmosphere-runtime/reachability-metadata.json`
inside `atmosphere-runtime`, which GraalVM reads on its own. That file is what a
plain-servlet or embedded deployment relies on, with no integration module and
no configuration; the Quarkus build step exists because Quarkus consumes build
items rather than that file.

Quarkus does not consume the `META-INF/atmosphere/annotated-classes.txt` index
that `atmosphere-runtime`'s annotation processor
(`org.atmosphere.nativeimage.AtmosphereAnnotationIndexProcessor`) writes. That
index serves runtimes which would otherwise scan the classpath at runtime —
something a native image makes impossible — and Jandex already indexes
annotations at build time here.

## Admin extension

`atmosphere-quarkus-admin-extension` mirrors the Spring `/api/admin/*`
surface for Quarkus apps, with three Quarkus-shaped deltas:

- **Fourth principal source** — on top of the Spring chain
  (`SecurityContext` → `org.atmosphere.auth.principal` attribute →
  `ai.userId` attribute), `AdminResource` also accepts the
  `X-Atmosphere-Auth` header and validates it constant-time against
  `atmosphere.admin.auth.token`. Intended for sample fixtures and
  operator tooling that haven't integrated Jakarta Security yet;
  production stacks still resolve Jakarta Security first.
- **`AdminReadAuthFilter`** — Quarkus JAX-RS `@Provider` that
  enforces the same `atmosphere.admin.http-read-auth-required`
  opt-in flag as the Spring `AdminApiAuthFilter`. Default off;
  multi-tenant operators flip it when exposing `/api/admin/*` on a
  routable network.
- **Vert.x dispatch** — `resteasy-reactive` runs on Vert.x, so
  servlet attribute access throws `IllegalStateException: UT000048`.
  `AdminResource` guards against this and reads `X-Atmosphere-Auth`
  via `@Context HttpHeaders`, which works on both servlet and
  reactive transports.

Everything else matches the Spring starter one-for-one — triple-gate
writes, audit log, `ControlAuthorizer` bean resolution via CDI (the
Quarkus `AdminProducer` looks up a user-supplied `ControlAuthorizer`
bean before falling back to `REQUIRE_PRINCIPAL`), and the MCP-tool
admin surface when `atmosphere-mcp` is also on the classpath.

## MCP servers on Quarkus

Beyond the admin surface, you can run a full MCP **server** on Quarkus: add
`atmosphere-agent` and `atmosphere-mcp` alongside the extension and set
`quarkus.atmosphere.packages` to your `@Agent` package. The Quarkus build step
recognizes `@Agent` and registers the MCP endpoint, tools, and OAuth
authorization exactly as on Spring Boot — see the
[MCP reference](/docs/reference/mcp/#running-on-quarkus). **JVM only**: no
native lane covers `@Agent`-based MCP (see [Native Image](#native-image)), and
no Quarkus MCP sample ships today (the capability is covered by the extension's
test suite).

## Running the sample

The `quarkus-chat` sample demonstrates a complete chat application:

```bash
cd samples/quarkus-chat
../../mvnw quarkus:dev
```

The chat UI is served from `src/main/resources/META-INF/resources/` and connects to the `@ManagedService` at `/atmosphere/chat`.
