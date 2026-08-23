---
title: "Migrating from 2.x to 4.0"
description: "Step-by-step guide for upgrading from Atmosphere 2.x to 4.0"
sidebar:
  order: 22
---

Atmosphere 4.0 is a major release with significant changes from 2.x. This chapter covers what changed, what was removed, and how to migrate step by step.

## Overview of Changes

| Area | 2.x | 4.0 |
|------|-----|-----|
| Java version | JDK 8+ | JDK 21+ |
| Servlet API | `javax.servlet` | `jakarta.servlet` (Jakarta EE 10+) |
| Dependency injection | `javax.inject` | `jakarta.inject` |
| Client library | atmosphere.js (JavaScript) | atmosphere.js 5.0 (TypeScript) |
| Chat/groups | Manual Broadcaster management | First-class Rooms API |
| Spring Boot | Spring Boot 2.x (community) | Spring Boot 4.0 (official starter) |
| Quarkus | Not supported | Official extension |

## Package Changes

All `javax.*` packages are now `jakarta.*`:

```java
// 2.x
import javax.inject.Inject;
import javax.servlet.http.HttpServletRequest;

// 4.0
import jakarta.inject.Inject;
import jakarta.servlet.http.HttpServletRequest;
```

## @ManagedService (Unchanged)

The core annotation model is the same. Your `@ManagedService` classes work with minimal changes:

```java
// Same in both 2.x and 4.0
@ManagedService(path = "/chat")
public class Chat {
    @Ready
    public void onReady() { }

    @Disconnect
    public void onDisconnect() { }

    @Message(encoders = {JacksonEncoder.class}, decoders = {JacksonDecoder.class})
    public Message onMessage(Message message) { return message; }
}
```

## Removed Features

The following have been removed or replaced in 4.0:

| Removed | Replacement |
|---------|-------------|
| Jersey integration | Use `@ManagedService` or Spring Boot |
| GWT support | Use atmosphere.js 5.0 |
| Socket.IO protocol | Use atmosphere.js 5.0 |
| Cometd protocol | Use atmosphere.js 5.0 |
| SwaggerSocket | Removed |
| Meteor API | Use `@ManagedService` |
| `@MeteorService` | Use `@ManagedService` |
| `web.xml`-only config | Still supported, but annotation-based is preferred |
| atmosphere-javascript | Replaced by atmosphere.js 5.0 (TypeScript, zero dependencies) |

## New Features in 4.0

| Feature | Description |
|---------|-------------|
| **Rooms** | Named groups with presence, history, direct messaging |
| **RoomManager** | Create/manage rooms backed by Broadcasters |
| **PresenceEvent** | Join/leave tracking with member identity |
| **RoomMember** | Application-level member ID (stable across reconnects) |
| **RoomAuthorizer** | Authorization for room operations |
| **Framework hooks** | React `useRoom`, Vue `useRoom`, Svelte `createRoomStore` |
| **Spring Boot 4.0 starter** | Auto-configuration, health, metrics, `@ManagedService` under Native Image ([scope](#native-image)) |
| **Quarkus extension** | Build-time processing, `@ManagedService` under Native Image ([scope](#native-image)) |

### Native Image

Both integrations are covered by a GraalVM Native Image job that runs on every change to the runtime, the starters or the extension. That job asserts exactly one thing, on both runtimes: a `@ManagedService` serves a real long-polling connection from a native binary. It builds `samples/spring-boot-chat` with `-Pnative` and `samples/quarkus-chat` with `-Dnative`, starts each binary, opens a long-polling connection to `/atmosphere/chat`, and fails unless the annotated `@Ready` method actually ran.

:::caution[What that job does not cover]
Everything below is untested under Native Image, so none of it is claimed to work there:

- WebSocket, SSE, and transport negotiation/fallback
- `@Message` encoder/decoder round-trips
- Rooms, `@RoomService`, presence, broadcast fan-out
- `@AiEndpoint` and `@Agent` — no native job builds the AI sample
- Injection beyond what `@Ready` requires

If you depend on any of these, verify them against your own native build before migrating.
:::

The migration itself requires no native-specific configuration. `atmosphere-runtime` ships `META-INF/native-image/org.atmosphere/atmosphere-runtime/reachability-metadata.json`, which GraalVM reads automatically, so a plain-servlet or embedded deployment needs no integration module. Your own annotated classes are indexed at compile time by `org.atmosphere.nativeimage.AtmosphereAnnotationIndexProcessor`, an annotation processor auto-discovered from `atmosphere-runtime` on the compile classpath. At runtime, discovery is the union of that index and the classpath scan — the index does not replace the scan.

If a module of your own loads classes by name, declare them by implementing `org.atmosphere.nativeimage.NativeImageMetadataProvider` and registering the implementation under `META-INF/services/`. `NativeImageMetadata.collect()` merges every provider on the classpath and feeds both Spring Boot starters and the Quarkus deployment processor; `atmosphere-runtime` is currently the only Atmosphere module that ships one.

## Client Migration

### 2.x (atmosphere-javascript)

```javascript
var socket = atmosphere;
var request = {
    url: '/chat',
    transport: 'websocket',
    fallbackTransport: 'long-polling'
};
request.onMessage = function(response) {
    var message = response.responseBody;
};
var subSocket = socket.subscribe(request);
subSocket.push(JSON.stringify(data));
```

### 4.0 (atmosphere.js 5.0, TypeScript)

```typescript
import { Atmosphere } from 'atmosphere.js';

const atm = new Atmosphere();
const sub = await atm.subscribe(
    {
        url: '/chat',
        transport: 'websocket',
        fallbackTransport: 'long-polling',
    },
    {
        message: (response) => {
            const data = JSON.parse(response.responseBody);
        },
    }
);
sub.push(JSON.stringify(data));
```

The global `atmosphere` object is still available for `<script>` tag usage (no build step):

```javascript
const sub = await atmosphere.atmosphere.subscribe(request, handlers);
```

## Step-by-Step Migration

1. **Update JDK** to 21+
2. **Replace** `javax.*` imports with `jakarta.*`
3. **Update** `atmosphere-runtime` dependency to the current `4.0.x` release (at time of writing, `4.0.68` on `main`; check Maven Central for the latest stable)
4. **Replace** Jersey/Meteor code with `@ManagedService` (if not already using it)
5. **Replace** `atmosphere-javascript` with `atmosphere.js` 5.0
6. **Optionally** adopt Rooms for group messaging patterns
7. **Optionally** adopt Spring Boot starter or Quarkus extension

## web.xml Changes

Update the web-app namespace for Jakarta EE:

```xml
<!-- 2.x -->
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="3.0">

<!-- 4.0 -->
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee" version="6.0">
```

The `AtmosphereServlet` class name is unchanged: `org.atmosphere.cpr.AtmosphereServlet`.
