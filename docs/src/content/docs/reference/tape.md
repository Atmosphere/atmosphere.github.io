---
title: "Session Tape"
description: "TapeStore SPI, TapeReplay reconstruction, config keys, and the gated admin API for the durable per-run event stream"
---

# Session Tape

The session tape records a streaming run's typed `AiEvent` stream — **as produced
at the session boundary** — as an append-only, per-run artifact in the
`org.atmosphere.ai.tape` package. It is **off by default**, and crash-durable
only with the SQLite store. It intentionally excludes synchronous
`generate` / `generateResult` turns, in-process coordinator fan-out *branch*
sessions (the root endpoint session is taped; A2A-dispatched children get their
own runs), pipeline-internal `StructuredOutputRetry` attempts, reattach replay,
and `modules/interactions` runs (persisted separately as `InteractionStep`s).
See the [Session Tape & Replay tutorial](/docs/tutorial/36-session-tape/) for the
narrative walkthrough.

## Configuration

| Key                         | Values / default                    | Meaning                                  |
|-----------------------------|-------------------------------------|------------------------------------------|
| `atmosphere.ai.tape.enabled`| `false` (default)                   | Master switch                            |
| `atmosphere.ai.tape.store`  | `sqlite` / `memory`                 | Backing store                            |
| `atmosphere.ai.tape.path`   | file path                           | SQLite DB location (sqlite store)        |

The `sqlite` store lives in `atmosphere-checkpoint` and needs `org.xerial:sqlite-jdbc`
at runtime; without it the tape falls back to a bounded in-memory store with a
startup warning (only a `durable()` store may back a "durable tape" claim —
Runtime Truth). Both stores are bounded by `maxRuns` / `maxStepsPerRun`; beyond
the per-run cap the writer stops recording and flags `truncated`.

## `TapeStore` SPI

Provide a custom store by publishing a `TapeStore` bean; the auto-configuration
uses it in place of the bundled store (it wraps externally-supplied stores so it
never closes what it did not create — Ownership).

```java
public interface TapeStore extends AutoCloseable {
    void begin(TapeRun run);
    void append(String runId, List<TapeStep> steps);
    void markTerminal(String runId, TapeStatus status, Counters counters);
    List<TapeRun> listRuns(TapeQuery query);
    List<TapeStep> readSteps(String runId, long fromSeq, int max); // max<=0 = all
    Optional<String> fork(String runId);
    void removeRun(String runId);
    int maxRuns();
    int maxStepsPerRun();
    boolean durable();
    String name();
}
```

Shipped implementations: `InMemoryTapeStore` (in `atmosphere-ai`) and
`SqliteTapeStore` (in `atmosphere-checkpoint`).

A `TapeRun` carries `runId`, `tapeId`, `sessionId`, `userId`, `endpoint`,
`model`, `runtimeName`, `status`, `stepCount`, and — for a fan-out child of a
multi-agent coordination — `parentRunId` (the dispatching coordinator's run id).

## `TapeReplay` — deterministic reconstruction

```java
// One run: prompt messages, coalesced output, tool calls, status. No model call.
Optional<ReplayedRun> reconstruct(TapeStore store, String runId);
ReplayedRun            reconstruct(TapeStore store, TapeRun run);

// A whole multi-agent coordination: root run + its parentRunId-linked children.
Optional<ReplayedTree> reconstructTree(TapeStore store, String rootRunId);
```

`ReplayedRun` exposes `input()` (`List<Message>`), `output()` (`String`),
`tools()` (`List<ToolCall>`), plus identity/status; `ReplayedTree` exposes
`root()`, `children()`, and `runCount()`. Reconstruction never calls a model —
it decodes the recorded `input` / `text` / `tool-start` steps.

Multi-agent children are linked by stamping the coordinator's run id onto the
fan-out with `AgentFleet.withParentRun(runId)`; it threads the id into the A2A
message metadata, and the receiving agent records it. LLM-agent children produce
a taped `AiPipeline` run; tool-agent children (`@AgentSkillHandler` returning
directly) are recorded as a single completed dispatch so the tree is complete
regardless of child type.

## Admin API

Read-only, gated behind the content-read-auth filter (the tape holds
pre-redaction content — default-deny, returns `401`/`403` unauthenticated):

```
GET /api/admin/tape/runs?tapeId=&status=&limit=200
GET /api/admin/tape/runs/{runId}/steps?fromSeq=0&max=500
GET /api/admin/tape/runs/{runId}/replay          # reconstructed coordination tree
```

The console reports `hasTape` on `/api/console/info` only when a recorder is
actually installed at runtime (not merely on the classpath), which gates the
Console **Tape** tab and its **▶ Replay** affordance.

## Distillation

Each `COMPLETED` run is a `(prompt → completion)` record. Extract chat-format
JSONL with the shipped CLI (`org.atmosphere.checkpoint.TapeDatasetCli`) and feed
any chat fine-tuner to distill a small local student, then serve it through the
`AgentRuntime` SPI. See the tutorial for the end-to-end loop.
