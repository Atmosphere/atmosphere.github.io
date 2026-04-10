---
title: "Install & Run"
description: "Install the Atmosphere CLI and have a running app in 30 seconds"
sidebar:
  order: 0
---

Get a running Atmosphere app in seconds — no Maven, no project setup, no boilerplate.

## Install the CLI

Pick whichever package manager you already have:

### curl

```bash
curl -fsSL https://raw.githubusercontent.com/Atmosphere/atmosphere/main/cli/install.sh | sh
```

The installer checks for Java 21+, downloads the `atmosphere` script to `/usr/local/bin`, and creates `~/.atmosphere/` for caching.

### Homebrew (macOS, Linux)

```bash
brew install Atmosphere/tap/atmosphere
```

### SDKMAN (macOS, Linux, WSL)

```bash
sdk install atmosphere
```

SDKMAN manages JDKs, Gradle, Maven, and now Atmosphere side-by-side. Switch versions with `sdk use atmosphere <version>` and list releases with `sdk list atmosphere`. If you haven't installed SDKMAN yet, see [sdkman.io](https://sdkman.io/install).

### npx (zero install, scaffolding only)

No Java CLI needed — scaffold a project straight from npm:

```bash
npx create-atmosphere-app my-chat-app
npx create-atmosphere-app my-ai-app --template ai-chat
```

`npx` gives you `atmosphere new` functionality without a local install, but running samples still needs the full CLI (`curl`, `brew`, or `sdk` above).

## Run Your First App

```bash
atmosphere run spring-boot-chat
```

That's it. The CLI downloads a pre-built JAR from GitHub Releases, caches it in `~/.atmosphere/cache/`, and starts a WebSocket chat app on `http://localhost:8080`. Open it in your browser — you have a working real-time chat.

### Try an AI Chat

```bash
atmosphere run spring-boot-ai-chat --env LLM_API_KEY=your-key
```

This starts an AI streaming chat that connects to Gemini, GPT, Claude, or Ollama — configured via environment variables. Without an API key, it runs in demo mode with simulated streaming.

### Browse All Samples

```bash
atmosphere install
```

The interactive picker shows every sample grouped by category. Pick one, then choose to **run it** or **install its source code** into your current directory:

```
  Atmosphere Samples

  CHAT
    1) spring-boot-chat                Real-time WebSocket chat with Spring Boot
    2) quarkus-chat                    Real-time WebSocket chat with Quarkus
    3) embedded-jetty-websocket-chat   Embedded Jetty WebSocket chat (no framework)

  AI
    4) spring-boot-ai-chat             AI streaming with conversation memory and structured events
    5) spring-boot-ai-classroom        Multiple clients share streaming AI responses
    6) spring-boot-ai-tools            Framework-agnostic @AiTool tool calling
    7) spring-boot-koog-chat           Kotlin-based Koog agent chat
    ...

  Pick a sample:
```

If [fzf](https://github.com/junegunn/fzf) is installed, you get fuzzy-search instead of numbered menus.

### Filter by Category or Tag

```bash
atmosphere install --tag ai          # AI samples only
atmosphere install --category tools  # Tool-calling samples
atmosphere list                      # List all samples without the picker
atmosphere info spring-boot-ai-chat  # Show details about a specific sample
```

## Create a New Project

When you're ready to write your own code:

```bash
atmosphere new my-app
atmosphere new my-ai-app --template ai-chat
atmosphere new my-rag-app --template rag
```

This scaffolds a complete Spring Boot + Atmosphere project with `pom.xml`, source code, and a frontend. Run it with `./mvnw spring-boot:run`.

### Available Templates

| Template | What you get |
|----------|-------------|
| `chat` | WebSocket chat with Broadcaster and `@ManagedService` |
| `ai-chat` | `@AiEndpoint` with streaming, conversation memory, and configurable LLM backend |
| `ai-tools` | AI tool calling with `@AiTool` and LangChain4j |
| `rag` | RAG chat with Spring AI vector store and embeddings |
| `quarkus-chat` | Real-time chat on Quarkus instead of Spring Boot |

### npx Alternative (Zero Install)

No Java CLI needed — scaffold from npm:

```bash
npx create-atmosphere-app my-chat-app
npx create-atmosphere-app my-ai-app --template ai-chat
```

### JBang Generator (Advanced)

For full control over the generated project:

```bash
jbang generator/AtmosphereInit.java --name my-app --handler ai-chat --ai spring-ai --tools
```

Options: `--handler` (chat, ai-chat, mcp-server), `--ai` (builtin, spring-ai, langchain4j, adk), `--tools` (include `@AiTool` methods). See [generator/README.md](https://github.com/Atmosphere/atmosphere/tree/main/generator) for details.

## Sample Catalog

### Chat

| Sample | Description | Port |
|--------|-------------|------|
| `spring-boot-chat` | Real-time WebSocket chat with Spring Boot | 8080 |
| `quarkus-chat` | Real-time WebSocket chat with Quarkus | 8080 |
| `embedded-jetty-websocket-chat` | Embedded Jetty, no framework | 8080 |

### AI Streaming & Tools

| Sample | Description | Port |
|--------|-------------|------|
| `spring-boot-ai-chat` | Conversation memory, structured events, capability validation | 8080 |
| `spring-boot-ai-classroom` | Multiple clients share streaming AI responses | 8080 |
| `spring-boot-ai-tools` | Framework-agnostic `@AiTool` tool calling | 8080 |
| `spring-boot-koog-chat` | Kotlin-based Koog agent chat | 8080 |
| `spring-boot-rag-chat` | RAG with Spring AI vector store | 8080 |

### Agents & Coordination

| Sample | Description | Port |
|--------|-------------|------|
| `spring-boot-dentist-agent` | Single-agent workflow with `@Agent` / `@Command` | 8080 |
| `spring-boot-multi-agent-startup-team` | Multi-agent coordinator with `@Coordinator` and `@Fleet` | 8080 |
| `spring-boot-orchestration-demo` | Orchestration primitives (handoffs, routing, judges) | 8080 |
| `spring-boot-a2a-agent` | Agent-to-agent (A2A) protocol | 8080 |
| `spring-boot-checkpoint-agent` | Agent with checkpoint/recovery | 8080 |

### Infrastructure

| Sample | Description | Port |
|--------|-------------|------|
| `spring-boot-mcp-server` | MCP tools, resources, and prompts for AI agents | 8080 |
| `spring-boot-otel-chat` | OpenTelemetry tracing with Jaeger | 8080 |
| `spring-boot-durable-sessions` | Session persistence with SQLite | 8080 |
| `spring-boot-channels-chat` | Channels API for pub/sub routing | 8080 |
| `spring-boot-agui-chat` | AgUI real-time agent UI | 8080 |
| `grpc-chat` | Mixed WebSocket + gRPC transport | 8080 |

Run `atmosphere list` for the full, current sample catalog.

## Environment Variables

All AI samples accept the same environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_API_KEY` | API key for your LLM provider | (none — runs in demo mode) |
| `LLM_MODEL` | Model name | `gemini-2.5-flash` |
| `LLM_BASE_URL` | Override API endpoint | (auto-detected from model name) |
| `LLM_MODE` | `remote` or `local` (Ollama) | `remote` |

Pass them via `--env`:

```bash
atmosphere run spring-boot-ai-chat \
  --env LLM_API_KEY=your-key \
  --env LLM_MODEL=gpt-4o
```

## Requirements

| Requirement | Version | How to install |
|-------------|---------|---------------|
| Java | 21+ | `brew install openjdk@21` or [SDKMAN](https://sdkman.io) |
| JBang | (optional) | `brew install jbang` — only for `atmosphere new` with full templates |
| fzf | (optional) | `brew install fzf` — for fuzzy-search sample picker |

## What's Next

Once you have a running sample, you're ready to understand the code. Start with [Chapter 1: Introduction](/docs/tutorial/01-introduction/) for the architecture, or jump straight to [Chapter 2: Getting Started](/docs/tutorial/02-getting-started/) to build your first app from scratch.
