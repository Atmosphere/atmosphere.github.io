---
title: Welcome
description: Getting started with Atmosphere documentation
sidebar:
  order: 0
---

Atmosphere is a transport-agnostic real-time framework for the JVM. Write to a Broadcaster, and the framework delivers to every subscriber — whether they're on a WebSocket, SSE stream, long-polling loop, or gRPC channel. Use `@ManagedService` for classic real-time (chat, dashboards, notifications, collaboration), or `@Agent` for AI-powered agents with tool calling, conversation memory, and multi-protocol exposure (MCP, A2A, AG-UI). Same framework, same transports, same clustering — you choose how much AI you need.

## How to Use This Documentation

**Want a running app now?** Install the CLI and run a sample in 30 seconds: [Install & Run](/docs/tutorial/00-cli/).

**New to Atmosphere?** Start with the [Tutorial](/docs/tutorial/01-introduction/) — a 24-chapter guide that builds your understanding from first principles to production deployment.

**Looking for a specific feature?** Use the Reference section for API details on the core runtime, rooms, AI, MCP, and more.

**Integrating with a framework?** The Integrations section covers Spring Boot 4.0, Quarkus 3.31, and AI framework adapters.

## Quick Links

### Real-Time Core

| What you want | Where to go |
|--------------|-------------|
| Run a sample in 30 seconds | [Install & Run (CLI)](/docs/tutorial/00-cli/) |
| Build your first app | [Chapter 2: Getting Started](/docs/tutorial/02-getting-started/) |
| `@ManagedService` deep dive | [Chapter 3](/docs/tutorial/03-managed-service/) |
| Transports (WebSocket, SSE, gRPC) | [Chapter 4](/docs/tutorial/04-transports/) |
| Broadcaster & pub/sub | [Chapter 5](/docs/tutorial/05-broadcaster/) |
| Rooms & presence | [Chapter 6](/docs/tutorial/06-rooms/) |
| React/Vue/Svelte hooks | [atmosphere.js](/docs/clients/javascript/) |
| Clustering (Redis/Kafka) | [Chapter 16](/docs/tutorial/16-clustering/) |

### AI & Agents

| What you want | Where to go |
|--------------|-------------|
| `@Agent` annotation | [@Agent](/docs/agents/agent/) |
| Multi-agent orchestration | [@Coordinator](/docs/agents/coordinator/) |
| AI/LLM streaming | [Chapter 9: @AiEndpoint](/docs/tutorial/09-ai-endpoint/) |
| Tool calling | [Chapter 10: @AiTool](/docs/tutorial/10-ai-tools/) |
| MCP server | [Chapter 13](/docs/tutorial/13-mcp/) |
| Testing AI agents | [AI Testing](/docs/reference/testing/) |

### Deployment

| What you want | Where to go |
|--------------|-------------|
| Spring Boot auto-config | [Spring Boot Reference](/docs/integrations/spring-boot/) |
| Quarkus extension | [Quarkus Reference](/docs/integrations/quarkus/) |
| Multi-channel (Slack, Telegram, ...) | [Chapter 23](/docs/tutorial/23-channels/) |

## Version

This documentation covers the **Atmosphere 4.0.x** release line with JDK 21+, Spring Boot 4.0.5 (Spring Framework 6.2.8), and Quarkus 3.31.3. See [What's New](/docs/whats-new/) for a highlights reel of changes since the 4.0.0 release.
