---
title: "Skills"
description: "Skill files, auto-discovery, GitHub import, and the Agent Skills standard"
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

Skills are reusable units of agent behavior — a system prompt, a set of tools, and configuration packaged together. Atmosphere discovers skill files automatically and makes them available to `@Agent` classes.

## Skill File Format

A skill file is a YAML document placed at `META-INF/skills/` on the classpath. It defines the agent's personality, capabilities, and constraints.

```yaml
# META-INF/skills/code-reviewer.skills
name: code-reviewer
description: Reviews pull requests for correctness and style
version: 1.0.0

system_prompt: |
  You are a senior code reviewer. Focus on correctness, performance,
  and readability. Be concise. Cite line numbers.

tools:
  - name: readFile
    description: Read a file from the repository
    parameters:
      path:
        type: string
        required: true
  - name: listFiles
    description: List files in a directory
    parameters:
      directory:
        type: string
        required: true

config:
  temperature: 0.2
  max_tokens: 4096
```

## Auto-Discovery

Atmosphere scans `META-INF/skills/` on the classpath at startup. Any `.skills` file found is loaded and registered. No explicit configuration is needed — just place the file in the right location.

For Maven projects, put skill files in `src/main/resources/META-INF/skills/`.

```
src/main/resources/
  META-INF/
    skills/
      code-reviewer.skills
      summarizer.skills
```

## Referencing Skills from `@Agent`

You can explicitly bind a skill file to an agent:

```java
@Agent(value = "/reviewer", skills = "classpath:META-INF/skills/code-reviewer.skills")
public class CodeReviewerAgent {
    // agent uses the code-reviewer skill
}
```

If no `skills` attribute is specified, Atmosphere matches by convention — an agent named `code-reviewer` will pick up `META-INF/skills/code-reviewer.skills` if present.

## Importing Skills from GitHub

The Atmosphere CLI can import skills from GitHub repositories:

```bash
atmosphere import https://github.com/org/repo/path/to/skill.skills
```

Imported skills are placed into your project's `META-INF/skills/` directory and are auto-discovered on the next build.

Over 1,200 skills are available in the public skill registry. Browse them at [github.com/Atmosphere/skills](https://github.com/Atmosphere/skills).

## Trusted Sources

By default, Atmosphere only loads skill files from the local classpath. To load skills from remote sources at runtime, configure trusted sources:

```properties
atmosphere.skills.trusted-sources=https://github.com/Atmosphere/*,https://github.com/your-org/*
```

Skills from untrusted sources are rejected at load time.

## The Agent Skills Standard

Atmosphere skill files follow the **Agent Skills** standard — an open specification for portable agent skill definitions. Skills written for Atmosphere can be used by any runtime that supports the standard, and vice versa.

Key properties of the standard:

- **Portable** — skill files are runtime-agnostic YAML documents
- **Composable** — agents can combine multiple skills
- **Versioned** — each skill declares a semantic version
- **Discoverable** — standard directory layout enables auto-discovery
