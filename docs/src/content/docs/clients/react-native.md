---
title: "React Native"
description: "React Native hooks with EventSource polyfill"
---

# React Native / Expo Guide

atmosphere.js `5.0.24` supports React Native and Expo via the `atmosphere.js/react-native` subpath export. Tested baseline: Expo SDK 55, React Native 0.83, React 19.2 (see `samples/spring-boot-ai-classroom/expo-client/package.json`).

## Installation

```bash
bun add atmosphere.js

# Optional: for network-aware reconnection
bun add @react-native-community/netinfo
```

## Quick Start

```typescript
// App.tsx
import NetInfo from '@react-native-community/netinfo';
import { setupReactNative, AtmosphereProvider, useAtmosphereRN } from 'atmosphere.js/react-native';

// Call once at app startup — pass NetInfo for network-aware reconnection
setupReactNative({ netInfo: NetInfo });

function Chat() {
  const { data, state, push, isConnected } = useAtmosphereRN({
    request: {
      url: 'https://your-server.com/atmosphere/chat',
      transport: 'websocket',
      fallbackTransport: 'long-polling',
    },
  });

  return (
    // your UI
  );
}

export default function App() {
  return (
    <AtmosphereProvider config={{ logLevel: 'info' }}>
      <Chat />
    </AtmosphereProvider>
  );
}
```

## Setup

### `setupReactNative()`

Call this once before any Atmosphere subscriptions are created. It:

- Installs a fetch-based EventSource polyfill (if the native one is missing)
- Detects ReadableStream support (Hermes on RN 0.73+ / Expo SDK 50+)
- Returns a capability report

```typescript
import NetInfo from '@react-native-community/netinfo';

const caps = setupReactNative({ netInfo: NetInfo });
// { hasReadableStream: true, hasWebSocket: true, recommendedTransports: ['websocket', 'streaming', 'long-polling'] }
```

Without NetInfo:

```typescript
const caps = setupReactNative();
// Works fine — isConnected defaults to true, network-aware reconnection is disabled
```

### `isReactNativeSetup()`

Returns `true` once `setupReactNative()` has run. Useful in tests and when a library wants to guard against double initialization.

```typescript
import { isReactNativeSetup, setupReactNative } from 'atmosphere.js/react-native';

if (!isReactNativeSetup()) {
  setupReactNative({ netInfo: NetInfo });
}
```

### Important: Absolute URLs

React Native has no `window.location`. All Atmosphere request URLs **must be absolute**:

```typescript
// Good
{ url: 'https://example.com/atmosphere/chat', transport: 'websocket' }

// Bad - will throw an error in RN
{ url: '/atmosphere/chat', transport: 'websocket' }
```

## Hooks

### `useAtmosphereRN`

Drop-in replacement for `useAtmosphere` with React Native lifecycle integration.

```typescript
const { data, state, push, isConnected, isInternetReachable } = useAtmosphereRN<Message>({
  request: { url: 'https://example.com/chat', transport: 'websocket' },
  backgroundBehavior: 'suspend', // 'suspend' | 'disconnect' | 'keep-alive'
});
```

**Background behavior options:**
- `suspend` (default) — pauses the transport when app goes to background, resumes on foreground
- `disconnect` — fully closes the connection, reconnects on foreground
- `keep-alive` — does nothing, connection stays open

**NetInfo integration** (when passed to `setupReactNative({ netInfo: NetInfo })`):
- `isConnected` / `isInternetReachable` reflect real network state
- Connection is suspended when offline, resumed when back online
- Falls back to `{ isConnected: true, isInternetReachable: true }` when NetInfo is not provided

### `useStreamingRN`

Drop-in replacement for `useStreaming` with the same RN lifecycle awareness.

```typescript
const { fullText, isStreaming, isConnected, send, reset, close } = useStreamingRN({
  request: { url: 'https://example.com/ai/chat', transport: 'websocket' },
});
```

Sends are suppressed when the device is offline.

### `useChatRN`

AI-SDK-style message/input state layered on `useStreamingRN`.

```typescript
const { messages, input, setInput, handleSubmit, isLoading } = useChatRN({
  request: { url: 'https://example.com/ai/chat', transport: 'websocket' },
});
```

`append()`, `reload()`, `stop()`, and `reset()` are also available for custom
chat UIs.

### `useAtmosphereCore`

Shared low-level hook exported from `atmosphere.js/react-native` for building custom hooks. It manages subscription lifecycle, state, and cleanup — the RN-aware `useAtmosphereRN` and `useStreamingRN` hooks are built on top of it. Use it when the built-in hooks don't fit your use case.

```typescript
import { useAtmosphereCore } from 'atmosphere.js/react-native';

function useMyCustomHook(request) {
  const { state, push, atmosphere } = useAtmosphereCore({
    request,
    handlers: {
      onOpen: () => {},
      onMessage: (data) => {},
    },
  });
  // ...
}
```

### Core hooks (re-exported)

These work as-is in React Native and are re-exported for convenience:
- `AtmosphereProvider` / `useAtmosphereContext`
- `useRoom`
- `usePresence`

## Transport Compatibility

| Transport | Expo SDK 55 / RN 0.83 (tested) | Expo SDK 50+ / RN 0.73+ | RN < 0.73 | Notes |
|-----------|------------------------------|-------------------------|-----------|-------|
| WebSocket | Full support | Full support | Full support | Primary transport |
| Long-Polling | Full support | Full support | Full support | Safe fallback (fetch only) |
| SSE | Native via polyfill | Via polyfill (streaming) | Via polyfill (text fallback) | Polyfill degrades to polling on old Hermes |
| Streaming | ReadableStream works | ReadableStream works | `response.body` is null | Skip on old Hermes |

`setupReactNative()` detects capabilities and reports recommended transports.

## Metro Bundler Configuration

When the app lives in a monorepo (e.g. `samples/spring-boot-ai-classroom/expo-client/` with a `file:` dependency on the atmosphere.js sources) Metro needs a few tweaks so it can resolve the shared workspace without duplicating React:

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, '../../..');

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'atmosphere.js/node_modules'),
];
config.resolver.extraNodeModules = new Proxy({}, {
  get: (_, name) => path.join(__dirname, `node_modules/${name}`),
});
config.resolver.blockList = [
  new RegExp(`${workspaceRoot}/atmosphere.js/node_modules/react/.*`),
];
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
```

### Top-level `AppState` import

The RN subpath uses a top-level `import { AppState } from 'react-native'`. Do **not** reach into esbuild/tsup's synthetic `require()` helper — Metro cannot statically resolve wrapped `require()` calls. If you vendor the source, keep the static top-level import.

### Explicit NetInfo injection

`@react-native-community/netinfo` is **not** imported by atmosphere.js — you must pass it explicitly: `setupReactNative({ netInfo: NetInfo })`. This keeps NetInfo optional and avoids Metro static-analysis failures on optional dependencies.

### Expo entry point

Expo Go requires `registerRootComponent(App)` at the entry. If you forget, the bundler builds but Expo Go never renders:

```typescript
// index.ts
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
```

## Known Limitations

- **Hermes + ReadableStream**: Hermes added ReadableStream support in RN 0.73 (Expo SDK 50). On older versions, SSE and streaming transports degrade or are unavailable.
- **No `window.location`**: All URLs must be absolute. The WebSocket transport throws a clear error if given a relative URL without `window.location`.
- **NetInfo is optional**: Pass it via `setupReactNative({ netInfo: NetInfo })`. Without it, `isConnected` defaults to `true` and network-aware reconnection is disabled.
- **Background audio**: If you need to keep a connection alive while the app plays audio in the background, use `backgroundBehavior: 'keep-alive'`.

## Sample App

See `samples/spring-boot-ai-classroom/expo-client/` for a complete Expo app that connects to the AI Classroom backend with 4 rooms (Math, Code, Science, General), streaming AI responses, and network status display.
