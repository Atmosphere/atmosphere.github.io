---
title: Admin Control Plane
description: Real-time dashboard, REST API, WebSocket event stream, and MCP tools for managing Atmosphere applications at runtime
---

The `atmosphere-admin` module adds a management and control plane to any Atmosphere application. Drop it on the classpath and you get a real-time dashboard, 25 REST endpoints, a WebSocket event stream, and MCP tools — all auto-configured.

## Quick Start

**Spring Boot** — add alongside your starter:

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-admin</artifactId>
</dependency>
```

Dashboard at `http://localhost:8080/atmosphere/admin/`.

**Quarkus** — use the dedicated extension:

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-quarkus-admin-extension</artifactId>
</dependency>
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest-jackson</artifactId>
</dependency>
```

Dashboard at `http://localhost:8080/admin/` (outside the Atmosphere servlet path).

## Dashboard

The admin dashboard is a self-contained UI served directly from the framework — no build step, no external dependencies. It connects to Atmosphere's own WebSocket transport for live event streaming.

### Dashboard Tab
Live counters for status, connections, broadcasters, agents, active sessions, tasks, and AI runtime. A real-time event feed shows `ResourceConnected`, `MessageBroadcast`, `AgentDispatched`, and other events as they happen. Broadcaster and connected resource tables update automatically.

### Agents Tab
Lists all registered `@Agent` and `@Coordinator` endpoints with name, version, path, headless flag, and protocol badges (a2a, mcp, agui). Shows available AI runtimes with capabilities and the MCP tool registry.

### Journal Tab
Queries the coordination journal with filters for coordination ID and agent name. Shows the execution graph of multi-agent coordinations — dispatches, completions, failures, handoffs, and evaluations.

### Control Tab
Operational actions behind the dashboard:
- **Broadcast** a message to any broadcaster
- **Disconnect** a specific client by UUID
- **Cancel** an in-flight A2A task
- All write operations appear in the **Audit Log** with timestamp, action, target, principal, and success/failure status.

## REST API

All endpoints are under `/api/admin/`.

### System Overview

```bash
curl http://localhost:8080/api/admin/overview
```

Returns an aggregated snapshot:
```json
{
  "status": "UP",
  "version": "4.0.36",
  "connections": 3,
  "broadcasters": 12,
  "handlers": 12,
  "interceptors": 10,
  "agentCount": 5,
  "activeSessions": 2,
  "coordinatorCount": 1,
  "taskCount": 0,
  "aiRuntime": "spring-ai"
}
```

### Agents

```bash
# List all agents
curl http://localhost:8080/api/admin/agents

# Active sessions for an agent
curl http://localhost:8080/api/admin/agents/ceo/sessions
```

### Framework Inspection

```bash
# Broadcasters, resources, handlers, interceptors
curl http://localhost:8080/api/admin/broadcasters
curl http://localhost:8080/api/admin/resources
curl http://localhost:8080/api/admin/handlers
curl http://localhost:8080/api/admin/interceptors
```

### Coordination Journal

```bash
# Query all events
curl http://localhost:8080/api/admin/journal

# Filter by agent
curl "http://localhost:8080/api/admin/journal?agent=research&limit=50"

# Formatted log for a coordination
curl http://localhost:8080/api/admin/journal/{coordinationId}/log
```

### Write Operations

```bash
# Broadcast to a broadcaster
curl -X POST http://localhost:8080/api/admin/broadcasters/broadcast \
  -H 'Content-Type: application/json' \
  -d '{"broadcasterId":"/atmosphere/agent/ceo","message":"Hello"}'

# Disconnect a client
curl -X DELETE http://localhost:8080/api/admin/resources/{uuid}

# Cancel an A2A task
curl -X POST http://localhost:8080/api/admin/tasks/{taskId}/cancel
```

## WebSocket Event Stream

Connect to `/atmosphere/admin/events` to receive real-time events via WebSocket. The dashboard uses this endpoint internally — it eats its own dog food.

Events are JSON objects with a `type` field:

| Event Type | Description |
|-----------|-------------|
| `ResourceConnected` | Client connected (uuid, transport, broadcaster) |
| `ResourceDisconnected` | Client disconnected (uuid, reason) |
| `BroadcasterCreated` / `Destroyed` | Broadcaster lifecycle |
| `MessageBroadcast` | Message sent to a broadcaster (id, resource count) |
| `AgentSessionStarted` / `Ended` | Agent session lifecycle (agent name, duration, message count) |
| `TaskStateChanged` | A2A task state transition (old state, new state) |
| `AgentDispatched` / `Completed` | Coordinator agent calls (coordination ID, agent, skill, duration) |
| `ControlActionExecuted` | Admin write operation (action, target, success) |

## MCP Tools — AI Manages AI

When `atmosphere-mcp` is on the classpath, admin operations are registered as MCP tools. An AI operator agent can inspect and control the fleet:

```
User: How many agents are running?
Agent: [calls atmosphere_list_agents] There are 5 agents registered:
  - ceo (coordinator, v1.0.0, a2a + mcp)
  - research-agent (headless, a2a + mcp)
  - strategy-agent (headless, a2a + mcp)
  - finance-agent (headless, a2a + mcp)
  - writer-agent (headless, a2a + mcp)
```

Write tools (`atmosphere_broadcast`, `atmosphere_disconnect_resource`, etc.) are opt-in:

```properties
atmosphere.admin.mcp-write-tools=true
```

## Security

The `ControlAuthorizer` SPI gates write operations. The default implementation allows all operations. In production, bind a concrete authorizer:

```java
@Bean
public ControlAuthorizer controlAuthorizer() {
    return (action, target, principal) -> {
        // Check roles, tokens, or other credentials
        return principal != null && hasRole(principal, "admin");
    };
}
```

## Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `atmosphere.admin.enabled` | `true` | Master kill switch |
| `atmosphere.admin.mcp-tools` | `true` | Register read MCP tools |
| `atmosphere.admin.mcp-write-tools` | `false` | Register write MCP tools (dangerous) |
