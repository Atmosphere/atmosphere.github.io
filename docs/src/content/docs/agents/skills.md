---
title: "Skills"
description: "Skill files, sections, auto-discovery, GitHub import, and the Agent Skills standard"
---

<!--
  Copyright 2008-2026 Async-IO.org

  Licensed under the Apache License, Version 2.0 (the "License"); you may not
  use this file except in compliance with the License. You may obtain a copy of
  the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
  WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
  License for the specific language governing permissions and limitations under
  the License.
-->

## Overview

A skill file is a **Markdown document** that becomes the agent's system prompt. Specific sections (`## Tools`, `## Skills`, `## Channels`, `## Guardrails`) are also parsed for protocol metadata — they populate the A2A Agent Card, MCP server info, and channel routing.

## Skill File Format

A skill file is plain Markdown. The `# Title` becomes the agent's display name. The body text becomes the system prompt verbatim. Named sections provide structured metadata.

```markdown
# Dr. Molar — Emergency Dental Assistant

You are Dr. Molar, a friendly dental emergency assistant.
You help patients who have broken, chipped, or cracked teeth.

## Skills
- Assess dental emergencies (broken, chipped, cracked teeth)
- Provide first-aid instructions for dental injuries
- Recommend pain management strategies

## Tools
- assess_emergency: Classify the severity of a dental emergency
- pain_relief: Recommend appropriate pain management

## Channels
- slack
- telegram
- web

## Guardrails
- Always state you are an AI, not a real dentist
- Never diagnose — only provide general guidance
- Always recommend seeing a real dentist
```

### Section Semantics

| Section | What it does |
|---------|-------------|
| `# Title` | Agent display name in console UI and Agent Card |
| Body text | Becomes the system prompt sent to the LLM |
| `## Skills` | Exported as capabilities in the A2A Agent Card |
| `## Tools` | Cross-referenced against `@AiTool` methods at startup. Mismatches produce warnings. |
| `## Channels` | Enables routing to listed channels (web, slack, telegram, discord, whatsapp, messenger) |
| `## Guardrails` | Included in the system prompt and exported to MCP server info |

### Tool Cross-Referencing

At startup, the framework cross-references the `## Tools` section against `@AiTool` methods on the agent class. If a tool is listed in the skill file but no matching `@AiTool` method exists, a warning is logged:

```
WARN: Skill file lists tool 'assess_emergency' but no @AiTool method found
```

This catches typos and stale skill files.

## Auto-Discovery

Atmosphere searches for skill files in this order:

1. `META-INF/skills/{agent-name}/SKILL.md` — preferred, can be packaged in JARs
2. `prompts/{agent-name}.md`
3. `prompts/{agent-name}-skill.md`
4. `prompts/skill.md` — fallback

No `skillFile` attribute needed — the framework matches by agent name automatically.

```
src/main/resources/
  prompts/
    dentist-skill.md       # matches @Agent(name = "dentist")
    ceo-skill.md           # matches @Agent(name = "ceo")
```

For distributing skills as Maven JARs:

```
src/main/resources/
  META-INF/
    skills/
      code-reviewer/
        SKILL.md           # matches @Agent(name = "code-reviewer")
```

## Referencing Skills from `@Agent`

Explicitly bind a skill file:

```java
@Agent(name = "dentist", skillFile = "prompts/dentist-skill.md",
       description = "Emergency dental assistant")
public class DentistAgent { ... }
```

Or let auto-discovery find it by name:

```java
@Agent(name = "dentist", description = "Emergency dental assistant")
public class DentistAgent { ... }
// auto-discovers prompts/dentist-skill.md or prompts/dentist.md
```

## Multi-Agent Skill Files

In a `@Coordinator` fleet, each agent has its own skill file. The coordinator also has one:

```
prompts/
  ceo-skill.md             # @Coordinator(name = "ceo")
  research-skill.md        # @Agent(name = "research")
  strategy-skill.md        # @Agent(name = "strategy")
  finance-skill.md         # @Agent(name = "finance")
  writer-skill.md          # @Agent(name = "writer")
```

Each specialist agent gets its own system prompt, tools, guardrails, and channel configuration. The coordinator's skill file describes the orchestration strategy.

## Importing Skills from GitHub

The Atmosphere CLI imports skills from GitHub and generates a complete Spring Boot project:

```bash
# Import from Anthropic's skills repository
atmosphere import https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md

cd frontend-design && LLM_API_KEY=your-key ./mvnw spring-boot:run
# Open http://localhost:8080/atmosphere/console/
```

The import command:
1. Parses the Markdown into `@Agent` annotations
2. Extracts `## Tools` into `@AiTool` method stubs
3. Places the skill file at `META-INF/skills/` for auto-discovery
4. Generates a Spring Boot project that compiles and runs immediately

Compatible with [Anthropic](https://github.com/anthropics/skills), [Antigravity](https://github.com/sickn33/antigravity-awesome-skills) (1,200+ skills), [K-Dense AI](https://github.com/K-Dense-AI/claude-scientific-skills), and any repository following the [Agent Skills](https://agentskills.io/specification) format.

## Trusted Sources

Remote imports are restricted to trusted sources by default. Use `--trust` for other URLs:

```bash
# Trusted by default
atmosphere import https://github.com/anthropics/skills/...

# Other sources require --trust
atmosphere import https://github.com/my-org/skills/... --trust
```

## The Agent Skills Standard

Atmosphere skill files follow the **Agent Skills** standard — an open specification for portable agent skill definitions. Skills written for Atmosphere can be used by any runtime that supports the standard, and vice versa.

- **Portable** — pure Markdown, runtime-agnostic
- **Composable** — agents can reference multiple skill files
- **Versioned** — YAML frontmatter supports semantic versioning
- **Discoverable** — standard directory layout enables auto-discovery

## See Also

- [@Agent](/docs/agents/agent/) — how agents reference skill files
- [@Coordinator](/docs/agents/coordinator/) — multi-agent skill file patterns
- [Dentist Agent sample](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-dentist-agent) — skill file with tools, channels, and guardrails
- [Startup Team sample](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-multi-agent-startup-team) — 5-agent fleet with coordinator skill
