---
title: "Session Tape & Replay"
description: "Record every AI turn as a durable, typed event stream — then deterministically replay a run, and a whole multi-agent coordination tree, from the tape alone with no model in the loop"
---

# Session Tape & Replay

A streaming AI turn crosses a `StreamingSession` as a stream of typed
`AiEvent`s — the input prompt, streamed text, tool calls, structured output, and
a terminal. When the **session tape** is enabled, it records that
session-boundary stream as an append-only, per-run artifact: one ordered list of
typed steps per run (crash-durable with the SQLite store). Because the tape is a
faithful record of what was produced at the session boundary, it doubles as an
**observability** surface, a **test oracle**, a **training set**, and — with
replay — a way to reconstruct a recorded session (or a team of agents) exactly,
with no model call.

The tape is **off by default** framework-wide. Turn it on with one flag.

## Enable the tape

```yaml
# application.yml
atmosphere:
  ai:
    tape:
      enabled: true
      store: sqlite        # crash-durable; needs atmosphere-checkpoint + sqlite-jdbc
      path: ${ATMOSPHERE_TAPE_PATH:${java.io.tmpdir}/atmosphere-tape.db}
```

```xml
<!-- pom.xml — the sqlite store lives in atmosphere-checkpoint -->
<dependency>
  <groupId>org.atmosphere</groupId>
  <artifactId>atmosphere-checkpoint</artifactId>
</dependency>
<dependency>
  <groupId>org.xerial</groupId>
  <artifactId>sqlite-jdbc</artifactId>
  <scope>runtime</scope>
</dependency>
```

Without `atmosphere-checkpoint` on the classpath the tape falls back to a bounded
in-memory store (with a startup warning) — durable across a process restart only
with the SQLite store. Both stores are bounded (`maxRuns` / `maxStepsPerRun`): a
full run stops recording and flags `truncated` rather than growing without
limit.

## What a run records

Each run is an ordered list of typed steps:

| Step kind      | Payload                                            |
|----------------|----------------------------------------------------|
| `input`        | the prompt as messages (system + history + user)   |
| `text`         | a segment of the assistant's streamed output       |
| `tool-start`   | a tool call: `toolName` + `arguments`              |
| `metadata`     | model / runtime / progress markers                 |
| terminal       | `complete` or `error`                              |

The tape records on **both** dispatch paths — the `@AiEndpoint` streaming path
and the channel/`AiPipeline` path (including cache hit and miss) — so a run
looks the same however it was invoked (Mode Parity). The writer is a bounded
single-consumer queue: a full queue drops a step and counts it (never blocking
the streaming path), and terminals are non-droppable.

:::note[What's *not* taped]
The tape captures events **as produced at the session boundary**, not delivery —
a disconnect can leave trailing steps produced-but-undelivered (status
`CANCELLED`). By design it also skips: synchronous `generate` / `generateResult`
turns, pipeline-internal `StructuredOutputRetry` attempts, in-process coordinator
fan-out *branch* sessions (the root endpoint session is taped; A2A-dispatched
children get their own runs — see the tree replay below), reattach replay
(already recorded at production time), and `modules/interactions` runs (persisted
separately as `InteractionStep`s).
:::

## See it in the Console

The bundled **Atmosphere Console** grows a **Tape** tab whenever a recorder is
actually installed at runtime (not merely on the classpath). It lists recorded
runs newest-first; selecting a run shows its ordered step stream. The tab and its
admin reads are gated behind the content-read-auth filter — the tape holds
*pre-redaction* content, so `/api/admin/tape/**` is default-deny.

```
GET /api/admin/tape/runs?limit=200          # recorded runs, newest first
GET /api/admin/tape/runs/{runId}/steps      # one run's ordered steps
GET /api/admin/tape/runs/{runId}/replay     # the reconstructed tree (below)
```

## Replay: reconstruct a run from the tape

Replay reads a recorded run back and rebuilds the session — the prompt messages,
the assistant output, and any tool calls — **deterministically, with no model in
the loop**. This is the "tape as source of truth" property: given only the tape,
the exact recorded session is reconstructed.

```java
import org.atmosphere.ai.tape.TapeReplay;
import org.atmosphere.ai.tape.TapeSupport;

var store = TapeSupport.installedStore().orElseThrow();

// One run: prompt, coalesced output, tool calls, status — no LLM call.
TapeReplay.reconstruct(store, runId).ifPresent(run -> {
    run.input();   // List<Message> — system / history / user
    run.output();  // the assistant's answer, coalesced from the text steps
    run.tools();   // List<ToolCall> — name + arguments
});
```

## Replay a whole multi-agent coordination — as a tree

When a `@Coordinator` fans out to specialist agents, each child agent's run is
linked to the coordinator's run by `parentRunId`. `reconstructTree` rebuilds the
whole team session — the coordinator run plus every child — as one ordered
transcript:

```java
TapeReplay.reconstructTree(store, coordinatorRunId).ifPresent(tree -> {
    tree.runCount();      // coordinator + N specialists
    tree.root();          // the coordinator's reconstructed run
    tree.children();      // each specialist, ordered by start time
});
```

To link the children, stamp the coordinator's run id onto the fan-out in your
`@Prompt`:

```java
@Prompt
public void onPrompt(String message, AgentFleet fleet, StreamingSession session) {
    // Every dispatch through this view carries the coordinator's run id as
    // parentRunId, so the whole coordination replays as a tree.
    var team = fleet.withParentRun(session.runId().orElse(null));
    var research = team.agent("research-agent").call("web_search", args);
    var results  = team.parallel(/* strategy, finance, writer */);
    // ...
}
```

`withParentRun` threads the id through the fleet's proxy/transport into the A2A
message metadata; the receiving agent inherits it and records it on its own tape
run. It works whether the children are **LLM-agents** (a taped `AiPipeline` run)
or **tool-agents** (an `@AgentSkillHandler` that returns directly — those are
recorded as a single completed dispatch so the tree is complete either way).

In the Console, the **Tape** tab's **▶ Replay** button on a coordinator run
renders the reconstructed tree as an **interactive node-graph**: one *coordinator*
node fanning out to one *agent* node per specialist, edges drawn by `parentRunId`,
each node showing its input, reconstructed output, and tool calls — all from the
tape, no model. Pan and zoom the canvas, or click a node to drill into that run's
ordered step stream.

## The tape as a training set

Because each completed run is a self-contained `(prompt → completion)` record,
the tape is also a distillation dataset. Extract chat-format JSONL and feed it to
any chat fine-tuner (MLX-LM `lora`, HuggingFace TRL, …) to distill a small local
student from a larger teacher's tapes, then serve the student back through the
same `AgentRuntime` SPI:

```bash
java -cp <classpath> org.atmosphere.checkpoint.TapeDatasetCli \
  "${ATMOSPHERE_TAPE_PATH}" train.jsonl
# -> one {"messages":[{system},{user},{assistant}]} line per COMPLETED run;
#    non-terminal / input-less / output-less runs are skipped and COUNTED.
```

## Where it fits

- **Record** — durable, typed, per-run event stream (this page).
- **Observe** — the Console **Tape** tab + `/api/admin/tape/**` reads.
- **Replay** — deterministic reconstruction of a run and a coordination tree.
- **Distill** — tape → JSONL → a smaller student served through `AgentRuntime`.

See the [Session Tape reference](/docs/reference/tape/) for the full `TapeStore` SPI,
config keys, and admin API, and [@Coordinator & Multi-Agent](/docs/agents/coordinator/)
for the fleet APIs the tree replay builds on.

:::note[Prior art]
The *tape* idea comes from ServiceNow Research's
[TapeAgents](https://www.servicenow.com/workflow/ai/tapeagents-framework-agentic-workflows.html),
which framed a typed, append-only log of an agent's steps as one artifact that
serves at once as state, observability, replayable history, and training data.
Atmosphere's session tape is an independent implementation of that idea at the
`StreamingSession` boundary.
:::
