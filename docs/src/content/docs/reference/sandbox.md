---
title: "Sandbox Execution"
description: "Pluggable isolated-execution primitive — agents run untrusted code, LLM-generated shell commands, and data transforms inside a Sandbox instead of the hosting JVM"
---

# Sandbox Execution

Agents that run untrusted code, LLM-generated shell commands, or data
transforms route those calls through a `Sandbox` instead of the hosting JVM.
The backend is pluggable: a Docker container ships as the production default,
and stronger isolation tiers (micro-VM, remote) plug in through the
`SandboxProvider` SPI without touching agent code.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-sandbox</artifactId>
    <version>${project.version}</version>
</dependency>
```

## SPI

| Type | Role |
|------|------|
| `Sandbox` | Per-instance resource. `exec(List<String> command, Duration timeout)`, `writeFile(Path, String)`, `readFile(Path)`, optional `expose(int port)`, `snapshot()`, `hibernate()`. `AutoCloseable` — never leaks to the hosting JVM. |
| `SandboxProvider` | Factory: `name()`, `isAvailable()`, `create(String image, SandboxLimits limits, Map<String,String> metadata)`, and `tier()` (defaults to `PROCESS`). Discovered via `ServiceLoader` — applications never `new` a provider directly. |
| `Sandboxes` | Tier-aware resolver. `Sandboxes.select(IsolationTier minTier)` returns the strongest available `SandboxProvider` at or above the requested floor, as an `Optional`. |
| `IsolationTier` | `PROCESS`, `CONTAINER`, `MICRO_VM`, `REMOTE` — ordered weakest to strongest. |
| `SandboxLimits` | A record `(double cpuFraction, long memoryBytes, Duration wallTime, NetworkPolicy networkPolicy)`. Ceilings enforced by each backend; exceeding one terminates the sandbox. |
| `NetworkPolicy` | Egress policy, per-sandbox (not global). `Mode` is `NONE`, `GIT_ONLY`, `ALLOWLIST`, `FULL`; constants `NetworkPolicy.NONE`, `NetworkPolicy.GIT_ONLY`, `NetworkPolicy.FULL`; build an allowlist with `NetworkPolicy.allowlist(host...)`. The default is `NONE`. |
| `@SandboxTool` | Annotation binding an `@AiTool` method to a provider's capabilities. |

## Backends shipped in-tree

- **`DockerSandboxProvider`** — the production default. Shells out to the
  `docker` CLI in argv form (no shell interpolation), with per-call `--rm`
  and `--network none` (unless `NetworkPolicy.FULL` is set) and a strict
  working-directory mount. Requires a running Docker daemon and fails hard
  when one is absent — it advertises availability from confirmed runtime
  state, never from classpath presence (Correctness Invariant #5, Runtime
  Truth).
- **`InProcessSandboxProvider`** — a dev-only reference implementation that
  runs commands via `ProcessBuilder` inside a temp directory. **It is not a
  security boundary.** It stays unavailable unless explicitly enabled with
  `-Datmosphere.sandbox.insecure=true`, and emits a `WARN` at startup. Tests
  and samples that cannot run Docker locally opt in deliberately.

## Third-party backends

Firecracker, Kata, Vercel Sandbox, E2B, Modal, and Blaxel ship in separate
modules that implement `SandboxProvider` and register through
`META-INF/services/org.atmosphere.ai.sandbox.SandboxProvider`. The foundation
module stays dependency-free.

## Quick Start

The `spring-boot-coding-agent` sample resolves a provider through the
tier-aware `Sandboxes.select(IsolationTier.PROCESS)` call — a `PROCESS` floor
that prefers the strongest available isolation — and drives it with the SPI
directly. There is no fluent builder, `allocate`, or varargs `exec`.

```java
@Agent(name = "coding-agent")
public class CodingAgent {

    // Tier-aware selection: PROCESS floor, preferring the strongest backend.
    private static SandboxProvider resolveProvider() {
        return Sandboxes.select(IsolationTier.PROCESS).orElse(null);
    }

    public String readFile(String gitUrl, String path) {
        var provider = resolveProvider();
        // SandboxLimits is a record: (cpuFraction, memoryBytes, wallTime, networkPolicy).
        // Cloning needs egress, so override the default NONE policy.
        var limits = new SandboxLimits(
                1.0, 512L * 1024L * 1024L, Duration.ofSeconds(30),
                NetworkPolicy.FULL);
        try (Sandbox sandbox = provider.create("alpine:3.20", limits,
                Map.of("owner", "coding-agent"))) {
            // exec takes a List<String> command and a per-call timeout.
            sandbox.exec(
                    List.of("git", "clone", "--depth", "1", gitUrl, "/workspace"),
                    Duration.ofMinutes(2));
            return sandbox.readFile(Path.of("/workspace/" + path));
        }
    }
}
```

Closing the `try-with-resources` terminates the sandbox: the container stops,
volumes unmount, and the temp directory is removed. The provider's lifecycle
is tied to the `Sandbox` handle, so callers never manage cleanup explicitly.

## Security notes

- Every `exec` is argv-form — no `sh -c` wrapping. The `coding-agent` sample
  exercises this against a strict GitHub-URL regex so shell metacharacters
  cannot escape.
- `DockerSandboxProvider` rejects volume mounts outside the per-sandbox
  workdir; path traversal is blocked with
  `Path.resolve().normalize().startsWith(workdir)`.
- `NetworkPolicy.FULL` is never the default. The `@SandboxTool` annotation
  (members `backend`, a required `image`, `cpuFraction`, `memoryBytes`,
  `wallTimeSeconds`, and `boolean network()` defaulting to `false`) opts a
  tool into egress with, e.g., `@SandboxTool(image = "ubuntu:24.04", network = true)`
  — the explicit `network = true` is the authorization receipt.

:::note
`@SandboxTool` is shipped API with a reference implementation, but no
production code path consumes the annotation yet — the sample wires
`SandboxLimits` and `NetworkPolicy` directly through the `SandboxProvider`
SPI. Treat `@SandboxTool` as available-but-not-yet-integrated rather than a
wired runtime path.
:::

## In-process `eval` — container-free JavaScript

The `Sandbox` SPI above runs code in a **container**. For lightweight
computation where a container is overkill — arithmetic, data shaping, JSON and
string work — Atmosphere also ships an in-process `eval` tool: a sandboxed
interpreter for model-authored code. It is the counterpart to `code_exec`: no
container, no network, instant, and available where Docker is not.

The interpreter is pluggable via the **`EvalEngine` SPI** (`ServiceLoader`,
highest-`priority()`-available wins — the same pattern as `AgentRuntime` and
`SandboxProvider`). **JavaScript via Mozilla Rhino ships as the default engine**;
an alternative — GraalJS, a Python interpreter, a WASM runtime — plugs in by
adding its jar with a `META-INF/services/org.atmosphere.ai.code.EvalEngine`
entry, no Atmosphere change required. Every engine must honour the same isolation
contract and `EvalLimits` (below).

> **Why an interpreter, not "pure Java"?** Two reasons. The model authors
> computation as *code strings at runtime*, and it writes JavaScript/Python, not
> Java. More fundamentally, arbitrary Java **cannot be sandboxed in-process**:
> JShell / the Compiler API produce bytecode with full JVM authority, and the
> only in-process containment mechanism — `SecurityManager` — is disabled from
> JDK 24 on. In-process *and* sandboxed therefore requires a language with a
> language-level sandbox (Rhino's `ClassShutter` + no built-in I/O); for
> OS-level isolation of arbitrary code, use the container `code_exec` instead.

**Off by default (opt-in).** Evaluating model-generated code is a deliberate
choice. Enable it with a system property (or the equivalent
`ORG_ATMOSPHERE_AI_EVAL_*` environment variable) and add the optional Rhino
dependency:

```bash
-Dorg.atmosphere.ai.eval.enabled=true
```

```xml
<dependency>
  <groupId>org.mozilla</groupId>
  <artifactId>rhino</artifactId>
</dependency>
```

| Property | Default | Meaning |
|---|---|---|
| `org.atmosphere.ai.eval.enabled` | `false` | Master switch — the tool is not offered unless `true` **and** Rhino is on the classpath. |
| `org.atmosphere.ai.eval.instructionBudget` | `10000000` | Interpreted-instruction ceiling per call — a runaway loop trips it and aborts. |
| `org.atmosphere.ai.eval.timeoutMillis` | `5000` | Wall-clock ceiling per call. |
| `org.atmosphere.ai.eval.maxOutputChars` | `8000` | Cap on the returned text. |

The tool advertises **runtime truth**: when `enabled=true` but Rhino is absent,
startup logs a warning and the tool reports inactive rather than offering
something that cannot run.

### Security model

- **No host reach.** The scope is built with Rhino's
  `initSafeStandardObjects()` — ECMAScript built-ins (`Math`, `JSON`, `Array`)
  but *none* of the LiveConnect Java bridge (`java`, `Packages`, `getClass`). A
  deny-all `ClassShutter` is layered on top, so no Java class resolves even via
  a reflective escape. Rhino JavaScript has no built-in file or network I/O.
- **Bounded CPU.** Interpreted mode plus an instruction observer enforce the
  budget on a stock JVM (no GraalVM runtime required). The abort is a Java
  `Error`, so a script `try/catch` cannot swallow it and keep looping.
- **No cross-call state.** Every call runs in a fresh scope — one evaluation
  cannot see or corrupt another's.
- **Governance-gateable.** The tool is tagged `ToolKind.EXECUTE`, so a
  `ToolApprovalPolicy` or governance policy gates it like any other
  code-execution surface.

## Source and samples

- Module README: [`modules/sandbox/README.md`](https://github.com/Atmosphere/atmosphere/blob/main/modules/sandbox/README.md)
- Sample: [`spring-boot-coding-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-coding-agent) — clone/read/stream coding workflow over the Docker sandbox provider
