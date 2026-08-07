---
title: "Quarkus"
description: "Build-time processing for Quarkus 3.36.0+"
---

# Quarkus Integration

A Quarkus extension that integrates Atmosphere with Quarkus 3.36.0+. Provides build-time annotation scanning via Jandex, Arc CDI integration, and build-time reflection registration for GraalVM Native Image.

CI builds `samples/quarkus-chat` into a native binary and asserts exactly one thing: a `@ManagedService` serves a real long-polling connection. WebSocket, SSE, `@Message` round-trips and the AI stack are **not** covered by any native lane -- see [GraalVM Native Image](#graalvm-native-image) for the full scope.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-quarkus-extension</artifactId>
    <version>${project.version}</version>
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

Atmosphere resolves much of its own machinery by name -- broadcaster caches, interceptors, annotation processors, encoders -- so ahead-of-time compilation drops classes that nothing statically references. The extension registers those classes at build time from three sources: the Jandex index (annotated classes, plus any class named inside `@Message(encoders/decoders)` or `@Ready(encoders)`), a short list of Quarkus-specific runtime classes, and the `NativeImageMetadataProvider` SPI described below.

### What CI proves

Job `quarkus-native` in [`native-image-ci.yml`](https://github.com/Atmosphere/atmosphere/blob/main/.github/workflows/native-image-ci.yml) builds `samples/quarkus-chat` into a native binary (Mandrel, container build), starts it, and drives a single request:

```bash
curl "http://localhost:8080/atmosphere/chat?X-Atmosphere-tracking-id=0&X-Atmosphere-Framework=2.3&X-Atmosphere-Transport=long-polling&X-Cache-Date=0"
```

The job fails unless the application log then contains `connected (broadcaster:`, a line only `Chat.onReady()` writes. Passing establishes, under a real native image: `@ManagedService` discovery from the Jandex index, handler registration, `Broadcaster` construction (and therefore its by-name-loaded cache class), `@Inject` of `AtmosphereResource` and a `@Named` `Broadcaster`, and `@Ready` firing -- over **long-polling**. A sibling job asserts the same path on the Spring Boot 4 starter with `samples/spring-boot-chat`.

### What CI does not prove

No native lane covers anything below. None of it should be described as native-verified until one does:

- **WebSocket** -- the smoke test pins the transport to long-polling by hand, so `quarkus.atmosphere.websocket-support` carries JVM-mode evidence only.
- **SSE, transport negotiation and fallback.**
- **`@Message` round-trip.** `registerEncoderDecoderClasses` does register the Quick Start's `JacksonEncoder` / `JacksonDecoder`, but the lane never POSTs a message, so the encode/decode path is compiled and never exercised.
- **Rooms / `@RoomService`, presence, broadcast fan-out, `@Disconnect`, `@Heartbeat`.**
- **The AI stack.** `samples/quarkus-ai-chat` has no native job and is not in the workflow's path filters; every `@AiEndpoint` statement on this page is JVM-mode evidence only.
- **Injection beyond what `@Ready` needs.**

> **Note:** Failures in this area are quiet rather than loud. A missing broadcaster-cache hint makes `createBroadcaster` throw `ClassNotFoundException`, which `ManagedServiceProcessor` catches and logs before carrying on -- the process starts, serves static content and answers a health probe, and the annotated endpoint simply never exists. A native coverage claim therefore has to name the request that was driven and the assertion that was made; "it booted" is not one.

### What the extension registers

`AtmosphereProcessor.registerReflection` feeds the image from three inputs:

- the Jandex-discovered annotated classes;
- four Quarkus-specific runtime classes (`QuarkusAtmosphereObjectFactory`, `QuarkusAtmosphereServlet`, `QuarkusJSR356AsyncSupport`, `LazyAtmosphereConfigurator`);
- `NativeImageMetadata.collect()` -- the merged `reflectiveTypes()` and `resourcePatterns()` of every `NativeImageMetadataProvider` on the build classpath, emitted as `ReflectiveClassBuildItem`s and `NativeImageResourceBuildItem`s, with the counts and provider names logged at INFO.

Two sibling build steps complete the picture: `registerPoolReflection` reads `AtmosphereReflectiveTypes.poolTypes()` behind a `commons-pool2` presence check, and `registerEncoderDecoderClasses` walks the Jandex index for `@Message(encoders/decoders)` and `@Ready(encoders)` so classes named only inside an annotation survive the image.

### Contributing your own reflective types

Implement `org.atmosphere.nativeimage.NativeImageMetadataProvider` to declare a class your application loads by name -- a custom `BroadcasterCache`, for instance -- next to the code that loads it, rather than needing an entry in a central list:

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

Register it in `src/main/resources/META-INF/services/org.atmosphere.nativeimage.NativeImageMetadataProvider`:

```
com.example.chat.ExampleMetadataProvider
```

`isAvailable()` (default `true`) lets a provider covering an optional dependency exclude itself when that dependency is absent; `priority()` only orders the emitted output. Collection is a **union**, so no provider can suppress another's types.

`atmosphere-runtime` is currently the only Atmosphere artifact shipping providers (`CoreNativeImageMetadataProvider` and `PoolNativeImageMetadataProvider`); the SPI exists so that other modules and applications can contribute without a change to this build step. Those same providers generate `META-INF/native-image/org.atmosphere/atmosphere-runtime/reachability-metadata.json` inside `atmosphere-runtime`, which GraalVM reads on its own -- that file is what a plain-servlet or embedded deployment relies on, with no integration module and no configuration. The Quarkus build step exists because Quarkus consumes build items rather than that file.

Quarkus does **not** consume the `META-INF/atmosphere/annotated-classes.txt` index that `atmosphere-runtime`'s annotation processor writes. That index serves runtimes which would otherwise scan the classpath at runtime -- something a native image makes impossible -- and Jandex already indexes annotations at build time here.

## `@AiEndpoint` annotation surfaces (new in 4.0.36)

The `@AiEndpoint` annotation works identically across Spring Boot and Quarkus — both frameworks use the same `AiEndpointProcessor` to read the annotation's `promptCache` and `retry` attributes. In Quarkus what happens at build time is *discovery*: `AtmosphereProcessor.scanAnnotations` reads `@AiEndpoint` out of the Jandex index, and the extension wires the Atmosphere **servlet** into the Undertow deployment. `AiEndpointProcessor` itself is an Atmosphere runtime annotation processor -- it reads `promptCache` and `retry` and registers the handler at servlet init, not during the Quarkus build. JVM mode only: no native lane covers `@AiEndpoint` ([What CI does not prove](#what-ci-does-not-prove)).

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

**Runtime coverage:** every framework adapter declares `PER_REQUEST_RETRY` honestly — they all inherit `AbstractAgentRuntime.executeWithOuterRetry` (introduced in 4.0.43, commit `374631e7`). Each adapter stacks this on top of its own native retry layer (Spring Retry, LC4j `RetryUtils`, ADK `HttpClient`, Koog `CallRetryPolicy`, SK `OpenAIAsyncClient`). See the [per-runtime capability matrix](../../tutorial/11-ai-adapters/#per-runtime-capability-matrix).

## Samples

- [Quarkus Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/quarkus-chat) -- real-time chat with WebSocket and long-polling fallback. Also the sample the native lane builds, where only the long-polling path is driven ([GraalVM Native Image](#graalvm-native-image))
- [Quarkus AI Chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/quarkus-ai-chat) -- five `@AiEndpoint` demos (basic streaming, retry, multi-modal, prompt caching, structured output) on Quarkus + Quarkus LangChain4j bridge, port `18810`. JVM mode only -- no native job builds this sample, and it is not in the native workflow's path filters

## See Also

- [Core Runtime](../reference/core/)
- [Spring Boot Integration](spring-boot/)
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/quarkus-extension)
