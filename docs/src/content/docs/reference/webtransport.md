---
title: "WebTransport over HTTP/3"
description: "Bidirectional streaming via QUIC — first Java framework with WebTransport"
---

# WebTransport over HTTP/3

Bidirectional streaming transport for Atmosphere using WebTransport over HTTP/3 (QUIC). The first Java framework with WebTransport support. Browsers connect over QUIC with multiplexed streams, built-in congestion control, and sub-millisecond latency — with automatic fallback to WebSocket.

## How It Works

The WebTransport server runs as a **Spring-managed sidecar** alongside the servlet container on a separate UDP port. Both transports feed into the same Atmosphere framework — your application code doesn't change. An `Alt-Svc` header tells browsers that HTTP/3 is available.

```
Spring Boot App
+----------------------------------+----------------------------+
| Servlet Container (Jetty/Tomcat) | Netty HTTP/3 (UDP sidecar) |
| HTTP/1.1, HTTP/2, WebSocket     | HTTP/3, WebTransport       |
+----------------+-----------------+-------------+--------------+
                 |                               |
                 v                               v
         AtmosphereFramework (doCometSupport / WebSocketProcessor)
                 |
     @Agent / @Prompt / @ManagedService / Handlers
```

## Quick Start

### 1. Add the dependency

```xml
<dependency>
    <groupId>io.projectreactor.netty</groupId>
    <artifactId>reactor-netty-http</artifactId>
</dependency>
```

This is managed by Spring Boot's BOM — no version needed.

### 2. Enable in application.yml

```yaml
atmosphere:
  web-transport:
    enabled: true
    port: 4443
```

The HTTP/3 server starts automatically with a self-signed ECDSA certificate for development. The certificate hash is exposed at `/api/webtransport-info`.

### 3. Connect from JavaScript

```typescript
import { Atmosphere } from 'atmosphere.js';

const atmosphere = new Atmosphere();

// Fetch cert hash for dev self-signed cert
const info = await (await fetch('/api/webtransport-info')).json();

const subscription = await atmosphere.subscribe({
  url: '/atmosphere/chat',
  transport: 'webtransport',
  fallbackTransport: 'websocket',
  webTransportUrl: `https://${location.hostname}:${info.port}/atmosphere/chat`,
  serverCertificateHashes: [info.certificateHash],
}, {
  open: () => console.log('Connected via WebTransport!'),
  message: (response) => console.log(response.responseBody),
});
```

In production behind a reverse proxy with real TLS, omit `webTransportUrl` and `serverCertificateHashes` — both protocols share the same origin.

## Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `atmosphere.web-transport.enabled` | `false` | Enable the HTTP/3 sidecar server |
| `atmosphere.web-transport.port` | `4443` | UDP port for QUIC/HTTP/3 |
| `atmosphere.web-transport.host` | `0.0.0.0` | Bind address |
| `atmosphere.web-transport.add-alt-svc` | `true` | Add `Alt-Svc` header to servlet responses |
| `atmosphere.web-transport.ssl.certificate` | (auto) | Path to PEM certificate file |
| `atmosphere.web-transport.ssl.private-key` | (auto) | Path to PEM private key file |

## Production Deployment

Use a reverse proxy (nginx, Cloudflare, Caddy) that terminates both HTTP/2 (TCP) and HTTP/3 (QUIC) on the same hostname:port:

```nginx
server {
    listen 443 ssl http2;
    listen 443 quic reuseport;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    add_header Alt-Svc 'h3=":443"; ma=86400';

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Browser Support

| Browser | Version | Coverage |
|---------|---------|----------|
| Chrome | 97+ | Jan 2022 |
| Edge | 98+ | Feb 2022 |
| Firefox | 114+ | Jun 2023 |
| Safari | 26.4+ | 2026 |
| Opera | 83+ | Mar 2022 |

~80% global coverage. The `fallbackTransport: 'websocket'` setting ensures all browsers work.

## Architecture

The server uses raw Netty HTTP/3 codec (not Reactor Netty's HttpServer) because WebTransport requires protocol features not exposed by Reactor Netty:

- **`ENABLE_CONNECT_PROTOCOL`** (RFC 9220) — extended CONNECT method
- **`H3_DATAGRAM`** (RFC 9297) — QUIC datagram support
- **`WEBTRANSPORT_MAX_SESSIONS`** — session negotiation (draft-02 + draft-07)
- **WebTransport frame type `0x41`** — bidirectional data streams

Sessions bridge into Atmosphere via `WebSocketProcessor.open()`, the same pattern used by JSR 356 WebSocket.

## Client API

The `WebTransportTransport` in atmosphere.js supports all standard `BaseTransport` features:

- Automatic reconnection with exponential backoff
- Protocol handshake and heartbeat
- Message tracking and length-delimited framing
- Outgoing/incoming interceptors
- Offline queue with drain-on-reconnect
- `suspend()` / `resume()` for pausing without disconnect

New request options:

| Option | Type | Description |
|--------|------|-------------|
| `webTransportUrl` | `string` | Explicit URL for the HTTP/3 server (dev mode) |
| `serverCertificateHashes` | `string[]` | Base64 SHA-256 cert hashes for self-signed certs |

## SPI

The `org.atmosphere.webtransport` package provides a transport-agnostic SPI:

| Class | Purpose |
|-------|---------|
| `WebTransportSession` | Abstract bidirectional stream session |
| `WebTransportHandler` | Application-level callbacks |
| `WebTransportProcessor` | Processing SPI |
| `WebTransportProtocol` | Message-to-request conversion |
| `WebTransportEventListener` | Lifecycle events |

## Limitations (v1)

- Single bidirectional stream per session (WebSocket-equivalent semantics)
- QUIC datagrams not yet exposed to application code
- Multiplexed streams deferred to v2
- Chrome strips query params from WebTransport CONNECT `:path` — auth tokens must use header-based authentication, not query parameters
