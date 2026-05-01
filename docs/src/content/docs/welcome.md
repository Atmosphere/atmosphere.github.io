---
title: Welcome
description: Getting started with Atmosphere documentation
sidebar:
  order: 0
---

Atmosphere is a transport-agnostic real-time framework for the JVM. Write to a Broadcaster, and the framework delivers to every subscriber — whether they're on **WebTransport over HTTP/3**, WebSocket, SSE, long-polling, or gRPC. Use `@ManagedService` for classic real-time (chat, dashboards, notifications, collaboration), or `@Agent` for AI-powered agents with tool calling, conversation memory, and multi-protocol exposure (MCP, A2A, AG-UI).

Because Atmosphere owns the broadcaster end-to-end, the framework does things a pure orchestration layer cannot: rewrites **PII tokens in-flight** before bytes reach the client, blocks outbound `@Prompt` dispatch when a tenant hits its **cost ceiling**, **replays mid-stream events** after a client reconnect via `X-Atmosphere-Run-Id`, stamps **tenant / customer / revenue tags** onto every log record for observability joins (Dynatrace / Datadog / OTel), and grounds every agent turn in deterministic **`FactResolver`** facts so the model stops making up the user's plan tier or the current time. Admin writes run a triple-gate (feature flag → Principal → `ControlAuthorizer`) with an opt-in read-side gate for multi-tenant deployments.

Same framework, same transports, same clustering — you choose how much AI you need.

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
| Plan-and-verify (refuse unsafe LLM plans before any tool fires) | [Chapter 33](/docs/tutorial/33-plan-and-verify/) |
| Guardrails (PII, drift, cost ceiling) | [Chapter 12: AI Filters](/docs/tutorial/12-ai-filters/) |
| MCP server | [Chapter 13](/docs/tutorial/13-mcp/) |
| Trust phases (`PermissionMode`) | [Chapter 25](/docs/tutorial/25-trust-phases/) |
| Business-outcome tagging (MDC) | [Chapter 27](/docs/tutorial/27-business-metadata-observability/) |
| Grounded facts (`FactResolver`) | [Chapter 28](/docs/tutorial/28-fact-resolver/) |
| Agent-to-agent flow viewer | [Chapter 29](/docs/tutorial/29-admin-flow-viewer/) |
| Testing AI agents | [AI Testing](/docs/reference/testing/) |

### Deployment

| What you want | Where to go |
|--------------|-------------|
| Spring Boot auto-config | [Spring Boot Reference](/docs/integrations/spring-boot/) |
| Quarkus extension | [Quarkus Reference](/docs/integrations/quarkus/) |
| Multi-channel (Slack, Telegram, ...) | [Chapter 23](/docs/tutorial/23-channels/) |

## Production Support

Atmosphere is Apache 2.0 and free to use. For teams running it in production, [Async-IO](https://async-io.live) — the team that wrote and maintains the framework — offers commercial support tiers, migration services, and a compliance evidence package built on the in-tree OWASP Agentic Top 10 / EU AI Act / HIPAA / SOC 2 matrices.

[Support tiers & SLA](https://async-io.live/#support) · [Book a 30-min call](https://async-io.live/contact/) · <support@async-io.org>

## Version

This documentation covers the **Atmosphere 4.0.x** release line with JDK 21+, Spring Boot 4.0.5 (Spring Framework 6.2.8), and Quarkus 3.31.3. See [What's New](/docs/whats-new/) for a highlights reel of changes since the 4.0.0 release.
