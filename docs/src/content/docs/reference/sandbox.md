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

## Source and samples

- Module README: [`modules/sandbox/README.md`](https://github.com/Atmosphere/atmosphere/blob/main/modules/sandbox/README.md)
- Sample: [`spring-boot-coding-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-coding-agent) — clone/read/stream coding workflow over the Docker sandbox provider
