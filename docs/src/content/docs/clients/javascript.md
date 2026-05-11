---
title: "atmosphere.js"
description: "TypeScript client with React, Vue, and Svelte hooks"
---

# atmosphere.js -- TypeScript Client

TypeScript client for the Atmosphere Framework (currently `5.0.22`). Supports WebTransport/HTTP3, WebSocket, SSE, HTTP Streaming, and Long-Polling transports with first-class React, Vue, and Svelte hooks.

## npm Coordinates

```bash
npm install atmosphere.js
```

## Quick Start

```typescript
import { atmosphere } from 'atmosphere.js';

const subscription = await atmosphere.subscribe({
  url: 'http://localhost:8080/chat',
  transport: 'websocket',
}, {
  message: (response) => console.log('Received:', response.responseBody),
  open: (response) => console.log('Connected via:', response.transport),
  close: (response) => console.log('Connection closed'),
  error: (error) => console.error('Error:', error),
});

subscription.push({ user: 'John', message: 'Hello World' });
```

The package ships ESM, CommonJS, and TypeScript declarations. Framework integrations are tree-shakeable subpath exports:

```typescript
import { Atmosphere } from 'atmosphere.js';
import { useAtmosphere, useStreaming, useRoom, usePresence } from 'atmosphere.js/react';
import { useAtmosphere, useStreaming, useRoom } from 'atmosphere.js/vue';
import { createAtmosphereStore, createStreamingStore, createRoomStore } from 'atmosphere.js/svelte';
import { useAtmosphereRN, useStreamingRN, setupReactNative } from 'atmosphere.js/react-native';
```

## Core API

### The `Atmosphere` Class

Manages subscriptions with automatic transport selection and fallback. Typically you use the shared `atmosphere` singleton, but you can also construct your own instance with per-client configuration or client-side interceptors:

```typescript
import { Atmosphere } from 'atmosphere.js';

const atm = new Atmosphere({
  logLevel: 'info',              // 'debug' | 'info' | 'warn' | 'error' | 'silent'
  defaultTransport: 'websocket',
  fallbackTransport: 'long-polling',
});

atm.version;       // '5.0.22'
atm.closeAll();    // Close every active subscription
atm.getSubscriptions();  // Map<string, Subscription>
```

### Subscribing with the full handler set

The `subscribe()` callback object accepts more than the four happy-path handlers shown in Quick Start. The extra handlers are essential for production reconnection UX:

```typescript
const subscription = await atmosphere.subscribe<ChatMessage>(
  {
    url: 'http://localhost:8080/atmosphere/chat',
    transport: 'websocket',
    fallbackTransport: 'sse',
    reconnect: true,
    reconnectInterval: 2000,
    maxReconnectOnClose: 5,
    contentType: 'application/json',
  },
  {
    open: (response) => console.log('Connected via', response.transport),
    message: (response) => console.log('Received:', response.responseBody),
    close: (response) => console.log('Disconnected'),
    error: (error) => console.error('Error:', error),
    transportFailure: (reason, request) => {
      console.warn(`${request.transport} failed: ${reason}, trying fallback`);
    },
    reconnect: (request, response) => {
      console.log('Reconnecting...');
    },
    failureToReconnect: (request, response) => {
      console.error('All reconnection attempts exhausted');
    },
  },
);
```

### Sending and closing

```typescript
subscription.push('Hello, world!');              // string
subscription.push({ author: 'Alice', text: 'Hi' }); // JSON object
subscription.push(new ArrayBuffer(16));          // binary

subscription.suspend();          // pause receiving
await subscription.resume();     // resume
await subscription.close();      // disconnect
```

### Connection states

`subscription.state` reflects the lifecycle and is what framework hooks expose as `state`:

| State | Description |
|-------|-------------|
| `disconnected` | Not connected |
| `connecting`   | Connection in progress |
| `connected`    | Connection established |
| `reconnecting` | Attempting to reconnect |
| `suspended`    | Paused via `suspend()` |
| `closed`       | Closed via `close()` |
| `error`        | Connection error |

## Resilience: `ConnectionStatus` + Badge components

Wiring all eight lifecycle hooks (`open`, `reopen`, `reconnect`, `close`, `error`, `transportFailure`, `clientTimeout`, `failureToReconnect`) on every consumer is busywork, and most apps end up showing only `connected`/`disconnected` because of it. atmosphere.js ships a `ConnectionStatus` primitive that collapses those events into a small phase machine plus a transient event indicator, and per-framework `<ConnectionStatusBadge />` components that render the result as a single import.

### The primitive (framework-agnostic)

```typescript
import { Atmosphere, ConnectionStatus } from 'atmosphere.js';

const status = new ConnectionStatus();
status.onChange((snap) => {
  // snap.phase       — 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'lost'
  // snap.lastEvent   — the most recent lifecycle hook that fired (or null)
  // snap.transport   — currently active transport (updates after fallback)
  // snap.attempt     — reconnect attempt counter; resets to 0 on every successful open
  // snap.viaFallback — true once a transportFailure has been observed
  // snap.lastError   — most recent error, or null
  // snap.since       — epoch-ms when the current phase began
  console.log(`[${snap.phase}] ${snap.transport}${snap.viaFallback ? ' (fallback)' : ''}`);
});

const atmosphere = new Atmosphere();
const sub = await atmosphere.subscribe(request, status.wrap({
  message: (m) => console.log(m),  // your own handlers are preserved
}));
```

`status.wrap(handlers)` returns a fresh `SubscriptionHandlers` object that calls **both** the status tracker and your own callbacks for each event — no double-subscription, no duplicated wiring.

### Phase state machine

```
idle ──subscribe()──▶ connecting ──open──▶ open ──close/reconnect──▶ reconnecting
                            │                                            │
                            │                                            ├──reopen──▶ open
                            │                                            │
                            └──fail (no fallback)──▶ lost ◀──failureToReconnect
                            │
                            └──close (clean)──▶ closed
```

`closed` and `lost` are terminal until the next `subscribe()` call. The `lastEvent` field always carries the most recent transition trigger so UIs can show transient affordances (toasts, badges) that the steady-state phase alone cannot express — for example, distinguishing a first `open` from a `reopen` after a disconnect.

### React: `useConnectionStatus` + `<ConnectionStatusBadge />`

Every React hook (`useAtmosphere`, `useStreaming`) now exposes `connectionStatus` reactively. Pass it straight to the Badge:

```tsx
import { useStreaming, ConnectionStatusBadge } from 'atmosphere.js/react';

function AiChat() {
  const { fullText, connectionStatus, send } = useStreaming({
    request: { url: '/ai/chat', transport: 'websocket', fallbackTransport: 'long-polling' },
    onTransportFailure: (reason) => console.warn('Falling back:', reason),
    onFailureToReconnect: () => alert('Connection lost — refresh to retry'),
  });

  return (
    <>
      <ConnectionStatusBadge status={connectionStatus} />
      <p>{fullText}</p>
    </>
  );
}
```

The Badge renders a colored dot + label inside a rounded pill — for example, `● Connected · websocket` while open, `● Reconnecting… · websocket` mid-reconnect, `● Connected · long-polling (fallback)` after a transport fallback, `● Connection lost · websocket` after `failureToReconnect`. Override colors and labels via the `colors` and `labels` props.

For consumers that manage their own subscription, use `useConnectionStatus` directly:

```tsx
import { useConnectionStatus, ConnectionStatusBadge } from 'atmosphere.js/react';

const { status, wrap } = useConnectionStatus();
useEffect(() => {
  let sub;
  (async () => { sub = await atmosphere.subscribe(req, wrap({ message: handle })); })();
  return () => sub?.close();
}, []);

return <ConnectionStatusBadge status={status} />;
```

### Vue: `useConnectionStatus` + `<ConnectionStatusBadge />`

```vue
<script setup lang="ts">
import { useStreaming, ConnectionStatusBadge } from 'atmosphere.js/vue';

const { fullText, connectionStatus, send } = useStreaming(
  { url: '/ai/chat', transport: 'websocket' },
  undefined,
  { onTransportFailure: (reason) => console.warn(reason) },
);
</script>

<template>
  <ConnectionStatusBadge :status="connectionStatus" />
</template>
```

### React Native: `<ConnectionStatusBadgeRN />`

`useStreamingRN` and `useAtmosphereRN` both expose `connectionStatus`, and the RN-native Badge uses `View`/`Text` (no DOM):

```tsx
import { useStreamingRN, ConnectionStatusBadgeRN } from 'atmosphere.js/react-native';

const { connectionStatus, send } = useStreamingRN({
  request,
  onTransportFailure: (reason) => console.warn(reason),
});

return <ConnectionStatusBadgeRN status={connectionStatus} />;
```

### Configuring fallback + reconnect

Resilience behavior is driven by the request options — the Badge just visualizes whatever the client decides:

| Option | Effect |
|--------|--------|
| `transport` | Primary transport (`websocket`, `sse`, `streaming`, `long-polling`, `webtransport`) |
| `fallbackTransport` | Used when the primary fails — fires `transportFailure` and continues with the fallback |
| `reconnect` | Enable auto-reconnect on close (default `true`) |
| `reconnectInterval` | Milliseconds between reconnect attempts |
| `maxReconnectOnClose` | Quota — when exhausted, `failureToReconnect` fires once and the phase moves to `lost` |
| `heartbeat.client` | Client-side watchdog interval (ms) — expiry triggers `clientTimeout` |

The classic fallback chain — WebSocket → SSE → streaming → long-polling — is implemented end-to-end. The `viaFallback` flag stays `true` until the next `subscribe()` call, so the Badge can keep showing the degraded-mode indicator even after the fallback transport reaches steady-state `open`.

## `AtmosphereRooms` — low-level rooms API

`AtmosphereRooms` is the vanilla-TypeScript counterpart of the `useRoom` / `createRoomStore` hooks. Use it when you don't want a framework integration or when you need a single rooms instance shared across parts of your app. It pairs with the server-side `RoomManager` and `RoomInterceptor`.

```typescript
import { Atmosphere, AtmosphereRooms } from 'atmosphere.js';

const atm = new Atmosphere();
const rooms = new AtmosphereRooms(atm, {
  url: '/atmosphere/chat',
  transport: 'websocket',
});

const lobby = await rooms.join('lobby', { id: 'alice' }, {
  message: (data, member) => console.log(`${member.id}: ${data}`),
  join:    (event)        => console.log(`${event.member.id} joined`),
  leave:   (event)        => console.log(`${event.member.id} left`),
});

lobby.broadcast('Hello!');
lobby.sendTo('bob', 'Direct message');
lobby.members;     // ReadonlyMap<string, RoomMember>
lobby.leave();

await rooms.leaveAll();   // Leave every room and close the underlying subscription
```

| `AtmosphereRooms` method | Description |
|---|---|
| `join(roomName, member, handlers)` | Join a room; returns `Promise<RoomHandle>` |
| `leave(roomName)` | Leave a specific room |
| `leaveAll()` | Leave all rooms and close the connection |
| `room(name)` | Get a `RoomHandle` by name (or `undefined`) |
| `joinedRooms()` | List all joined room names |

## React Hooks

All hooks require an `<AtmosphereProvider>` ancestor.

```tsx
import { AtmosphereProvider } from 'atmosphere.js/react';

function App() {
  return (
    <AtmosphereProvider>
      <Chat />
    </AtmosphereProvider>
  );
}
```

### useAtmosphere

Subscribe to an endpoint:

```tsx
import { useAtmosphere } from 'atmosphere.js/react';

function Chat() {
  const { data, state, push } = useAtmosphere<Message>({
    request: { url: '/chat', transport: 'websocket' },
  });

  return state === 'connected'
    ? <button onClick={() => push({ text: 'Hello' })}>Send</button>
    : <p>Connecting...</p>;
}
```

### useRoom

Join a room with presence:

```tsx
import { useRoom } from 'atmosphere.js/react';

function ChatRoom() {
  const { joined, members, messages, broadcast } = useRoom<ChatMessage>({
    request: { url: '/atmosphere/room', transport: 'websocket' },
    room: 'lobby',
    member: { id: 'user-1' },
  });

  return (
    <div>
      <p>{members.length} online</p>
      {messages.map((m, i) => <div key={i}>{m.member.id}: {m.data.text}</div>)}
      <button onClick={() => broadcast({ text: 'Hi' })}>Send</button>
    </div>
  );
}
```

### usePresence

Lightweight presence tracking:

```tsx
import { usePresence } from 'atmosphere.js/react';

function OnlineUsers() {
  const { members, count, isOnline } = usePresence({
    request: { url: '/atmosphere/room', transport: 'websocket' },
    room: 'lobby',
    member: { id: currentUser.id },
  });

  return <p>{count} users online. Alice is {isOnline('alice') ? 'here' : 'away'}.</p>;
}
```

### useStreaming

AI/LLM text streaming:

```tsx
import { useStreaming } from 'atmosphere.js/react';

function AiChat() {
  const { fullText, isStreaming, stats, routing, send } = useStreaming({
    request: { url: '/ai/chat', transport: 'websocket' },
  });

  return (
    <div>
      <button onClick={() => send('Explain WebSockets')} disabled={isStreaming}>Ask</button>
      <p>{fullText}</p>
      {stats && <small>{stats.totalStreamingTexts} streaming texts</small>}
    </div>
  );
}
```

## Vue Composables

Vue composables do not require a provider -- they create or accept an Atmosphere instance directly.

### useAtmosphere

```vue
<script setup lang="ts">
import { useAtmosphere } from 'atmosphere.js/vue';

const { data, state, push } = useAtmosphere<ChatMessage>({
  url: '/chat',
  transport: 'websocket',
});
</script>

<template>
  <p>Status: {{ state }}</p>
  <button @click="push({ text: 'Hello!' })">Send</button>
</template>
```

### useRoom

```vue
<script setup lang="ts">
import { useRoom } from 'atmosphere.js/vue';

const { members, messages, broadcast } = useRoom<ChatMessage>(
  { url: '/atmosphere/room', transport: 'websocket' },
  'lobby',
  { id: 'user-1' },
);
</script>
```

### usePresence

```vue
<script setup lang="ts">
import { usePresence } from 'atmosphere.js/vue';

const { members, count, isOnline } = usePresence(
  { url: '/atmosphere/room', transport: 'websocket' },
  'lobby',
  { id: currentUser.id },
);
</script>
```

### useStreaming

```vue
<script setup lang="ts">
import { useStreaming } from 'atmosphere.js/vue';

const { fullText, isStreaming, send, reset } = useStreaming({
  url: '/ai/chat',
  transport: 'websocket',
});
</script>

<template>
  <button @click="send('What is Atmosphere?')">Ask</button>
  <p>{{ fullText }}</p>
  <span v-if="isStreaming">Generating...</span>
</template>
```

## Svelte Stores

Svelte integrations use the store pattern -- each factory returns a Svelte-compatible readable store plus action functions.

### createAtmosphereStore

```svelte
<script>
  import { createAtmosphereStore } from 'atmosphere.js/svelte';

  const { store: chat, push } = createAtmosphereStore({ url: '/chat', transport: 'websocket' });
</script>

<p>Status: {$chat.state}</p>
<button on:click={() => push({ text: 'Hello!' })}>Send</button>
```

### createRoomStore

```svelte
<script>
  import { createRoomStore } from 'atmosphere.js/svelte';

  const { store: lobby, broadcast } = createRoomStore(
    { url: '/atmosphere/room', transport: 'websocket' },
    'lobby',
    { id: 'user-1' },
  );
</script>

<p>Members: {$lobby.members.map(m => m.id).join(', ')}</p>
<button on:click={() => broadcast({ text: 'Hello!' })}>Broadcast</button>
```

### createPresenceStore

```svelte
<script>
  import { createPresenceStore } from 'atmosphere.js/svelte';

  const presence = createPresenceStore(
    { url: '/atmosphere/room', transport: 'websocket' },
    'lobby',
    { id: 'user-1' },
  );
</script>

<p>{$presence.count} users online</p>
```

### createStreamingStore

```svelte
<script>
  import { createStreamingStore } from 'atmosphere.js/svelte';

  const { store, send, reset } = createStreamingStore({
    url: '/ai/chat',
    transport: 'websocket',
  });
</script>

<button on:click={() => send('What is Atmosphere?')}>Ask</button>
<p>{$store.fullText}</p>
{#if $store.isStreaming}<span>Generating...</span>{/if}
```

## AI Streaming Wire Protocol

The server sends JSON messages using the Atmosphere AI streaming protocol:

```json
{"type": "streaming-text",    "data": "Hello",      "sessionId": "abc-123", "seq": 1}
{"type": "progress", "data": "Thinking...", "sessionId": "abc-123", "seq": 2}
{"type": "metadata", "key": "model",  "value": "gpt-4", "sessionId": "abc-123", "seq": 3}
{"type": "complete", "data": "Done",        "sessionId": "abc-123", "seq": 10}
{"type": "error",    "data": "Rate limited","sessionId": "abc-123", "seq": 11}
```

Use `subscribeStreaming` for framework-agnostic streaming, or the hooks above for React/Vue/Svelte.

## Request Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | *(required)* | Endpoint URL |
| `transport` | `TransportType` | `'websocket'` | `'webtransport'` · `'websocket'` · `'sse'` · `'long-polling'` · `'streaming'` |
| `fallbackTransport` | `TransportType` | — | Transport to use if primary fails |
| `contentType` | `string` | `'text/plain'` | Content type for messages |
| `trackMessageLength` | `boolean` | — | Enable message length prefixing (recommended: `true`) |
| `messageDelimiter` | `string` | `'\|'` | Delimiter used with length prefixing |
| `enableProtocol` | `boolean` | — | Enable Atmosphere protocol handshake |
| `reconnect` | `boolean` | `true` | Auto-reconnect on disconnect |
| `reconnectInterval` | `number` | — | Base delay between reconnection attempts (ms) |
| `maxReconnectOnClose` | `number` | `5` | Max reconnection attempts |
| `maxRequest` | `number` | — | Max long-polling request cycles |
| `timeout` | `number` | — | Inactivity timeout (ms) |
| `connectTimeout` | `number` | — | Connection timeout (ms) |
| `headers` | `Record<string, string>` | — | Custom HTTP headers |
| `withCredentials` | `boolean` | — | Include cookies (CORS) |
| `sessionToken` | `string` | — | Durable session token, sent as `X-Atmosphere-Session-Token` |
| `heartbeat` | `{ client?: number; server?: number }` | — | Heartbeat intervals (ms) |

## Durable Session Tokens

`atmosphere.js` supports durable sessions (see [Durable Sessions tutorial](/docs/tutorial/17-durable-sessions/)) via the `sessionToken` request property. The server assigns a token on first connect and sends it in the response headers; the client stores it (e.g., in `localStorage`) and replays it on reconnect to resume the same logical session across page refreshes and network outages:

```typescript
const sub = await atmosphere.subscribe({
  url: '/atmosphere/chat',
  transport: 'websocket',
  sessionToken: localStorage.getItem('atmosphere-session') ?? undefined,
}, {
  open: (response) => {
    const token = response.headers['X-Atmosphere-Session-Token'];
    if (token) localStorage.setItem('atmosphere-session', token);
  },
});
```

## Client-side Interceptors

Interceptors transform messages before sending and after receiving, like a middleware stack. Outgoing interceptors run in declaration order; incoming interceptors run in reverse order so the outermost wrapper unwraps last.

```typescript
const atm = new Atmosphere({
  interceptors: [
    {
      name: 'json',
      onOutgoing: (data) => typeof data === 'string' ? data : JSON.stringify(data),
      onIncoming: (body) => JSON.parse(body),
    },
    {
      name: 'envelope',
      onOutgoing: (body) => JSON.stringify({ payload: body, ts: Date.now() }),
      onIncoming: (body) => JSON.parse(body).payload,
    },
  ],
});
```

## Pairing with `@ManagedService`

The client connects to server endpoints defined with `@ManagedService`. A minimal server-client pair:

**Server (Java):**

```java
@ManagedService(path = "/atmosphere/chat")
public class Chat {

    @Inject private AtmosphereResource r;

    @Ready
    public void onReady() {
        // Client connected
    }

    @Message
    public String onMessage(String message) {
        return message; // Echo to all subscribers
    }
}
```

**Client (TypeScript):**

```typescript
const sub = await atmosphere.subscribe(
  { url: '/atmosphere/chat', transport: 'websocket' },
  { message: (res) => console.log(res.responseBody) },
);

sub.push('Hello from atmosphere.js');
```

See [`@ManagedService` tutorial](/docs/tutorial/03-managed-service/) for the full server-side API.

## Browser Compatibility

- Chrome/Edge: last 2 versions
- Firefox: last 2 versions + ESR
- Safari: last 2 versions
- Mobile Safari (iOS): last 2 versions
- Chrome Android: last 2 versions

## API Reference

Complete TypeScript type reference for the public surface.

### `Atmosphere`

```typescript
class Atmosphere {
  readonly version: string;  // '5.0.22'

  constructor(config?: {
    logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
    defaultTransport?: TransportType;
    fallbackTransport?: TransportType;
    interceptors?: AtmosphereInterceptor[];
  });

  subscribe<T = unknown>(
    request: AtmosphereRequest,
    handlers: SubscriptionHandlers<T>,
  ): Promise<Subscription<T>>;

  closeAll(): void;
  getSubscriptions(): Map<string, Subscription>;
}
```

### `AtmosphereRequest`

```typescript
interface AtmosphereRequest {
  url: string;
  transport?: TransportType;
  fallbackTransport?: TransportType;
  contentType?: string;
  trackMessageLength?: boolean;
  messageDelimiter?: string;
  enableProtocol?: boolean;
  timeout?: number;
  connectTimeout?: number;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectOnClose?: number;
  maxRequest?: number;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  sessionToken?: string;
  heartbeat?: { client?: number; server?: number };
}

type TransportType =
  | 'webtransport'
  | 'websocket'
  | 'sse'
  | 'long-polling'
  | 'streaming';
```

### `SubscriptionHandlers`

```typescript
interface SubscriptionHandlers<T = unknown> {
  open?:               (response: AtmosphereResponse<T>) => void;
  message?:            (response: AtmosphereResponse<T>) => void;
  close?:              (response: AtmosphereResponse<T>) => void;
  error?:              (error: Error) => void;
  reopen?:             (response: AtmosphereResponse<T>) => void;
  reconnect?:          (request: AtmosphereRequest, response: AtmosphereResponse<T>) => void;
  transportFailure?:   (reason: string, request: AtmosphereRequest) => void;
  clientTimeout?:      (request: AtmosphereRequest) => void;
  failureToReconnect?: (request: AtmosphereRequest, response: AtmosphereResponse<T>) => void;
}
```

### `Subscription`

```typescript
interface Subscription<T = unknown> {
  readonly id: string;
  readonly state: ConnectionState;

  push(message: string | object | ArrayBuffer): void;
  close(): Promise<void>;
  suspend(): void;
  resume(): Promise<void>;

  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'suspended'
  | 'closed'
  | 'error';
```

### `RoomHandle`, `RoomMember`, `PresenceEvent`, `RoomMessage`

```typescript
interface RoomHandle<T = unknown> {
  readonly name: string;
  readonly members: ReadonlyMap<string, RoomMember>;
  broadcast(data: T): void;
  sendTo(memberId: string, data: T): void;
  leave(): Promise<void>;
}

interface RoomMember {
  id: string;
  metadata?: Record<string, unknown>;
}

interface PresenceEvent {
  type: 'join' | 'leave';
  room: string;
  member: RoomMember;
  timestamp: number;
}

interface RoomMessage<T = unknown> {
  type: 'join' | 'leave' | 'broadcast' | 'direct' | 'presence';
  room: string;
  data?: T;
  member?: RoomMember;
  target?: string;   // for direct messages
}
```

### `AtmosphereInterceptor`

```typescript
interface AtmosphereInterceptor {
  name?: string;
  onOutgoing?: (data: string | ArrayBuffer) => string | ArrayBuffer;
  onIncoming?: (body: string) => string;
}
```

Applied in order for outgoing messages and in reverse order for incoming — the middleware-stack pattern.

## See Also

- [AI Integration](../../reference/ai/) — server-side `@AiEndpoint` and `StreamingSession`
- [Rooms & Presence](../../reference/rooms/) — server-side room management
- [`@ManagedService`](../../tutorial/03-managed-service/) — server-side endpoint API
- [Durable Sessions](../../tutorial/17-durable-sessions/) — session token lifecycle
- [wAsync Java Client](../java/)
- [React Native Guide](../react-native/)
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/atmosphere.js)
