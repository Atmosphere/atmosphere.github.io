---
title: "AI-Assisted Engineering Harness"
description: "How Atmosphere keeps prose claims honest against running code — capability snapshot, drift log, validators, and Claude Code Stop hook as a reusable feedback-loop pattern for AI-assisted projects."
---

The model is the engine. The harness is the rails.

This chapter documents the small instrumentation layer Atmosphere uses to
keep its own engineering loop honest under heavy AI-assisted contribution.
It exists because we burned ourselves enough times shipping prose that
disagreed with code (capability counts off by 3, runtime lists missing
adopters, "PENDING" features that shipped weeks ago) that we eventually
turned the catch-and-fix protocol into running code. The pattern is small
and reusable; if you maintain a project that AI agents contribute to, the
shape here transfers.

The framing is Justin Reock's
[*AI-Assisted Engineering*](https://www.infoq.com/presentations/ai-assisted-engineering/)
(InfoQ, 2026-05): the orgs that get +20% from AI have an instrumented
feedback loop on claim quality; the orgs that get −20% don't. Utilization
metrics ("% of code AI-authored", "AI-assisted PR count") trigger
Goodhart's Law and lose validity once they become targets. The right
impact metric is **change failure rate by agent claim**.

## The directory shape

Everything lives under `.harness/` at the repo root, plus a few scripts
and a Claude Code hook. Anyone seeing the directory knows it's
project-engineering plumbing, not runtime code:

```
.harness/
├── README.md                       Operator manual for this directory
├── capabilities.snapshot.json      Canonical capability matrix snapshot
└── drift-log.md                    Append-only record of caught hallucinations

scripts/
├── regen-capability-snapshot.sh    Re-derive snapshot from source
├── validate-capability-claims.sh   Pre-push gate: prose ↔ snapshot agreement
└── validate-drift-log.sh           Pre-push gate: append-only structural hygiene

modules/ai-test/.../CapabilitySnapshotTest.java
                                    JUnit mirror of the bash validator

.claude/
├── hooks/check-drift-log.sh        Stop hook: block session-end on undocumented drift
└── settings.json                   Project-level Claude Code hook registration
```

## Capability snapshot — pin prose against running code

`AiCapability` is a 20-entry Java enum
([source](https://github.com/Atmosphere/atmosphere/blob/main/modules/ai/src/main/java/org/atmosphere/ai/AiCapability.java)).
Each of the 9 framework runtimes overrides
`AbstractAgentRuntimeContractTest.expectedCapabilities()` to declare its
exact subset, and the contract test asserts the runtime's live
`capabilities()` method returns the same set. That's the existing per-runtime
gate — it catches code drift but doesn't catch *prose drift* in the
README's count claims.

The snapshot closes that gap. `scripts/regen-capability-snapshot.sh`
parses `AiCapability.java` and every `*RuntimeContractTest.{java,kt}`
file, then writes a deterministic JSON aggregate to
`.harness/capabilities.snapshot.json`:

```json
{
  "schema_version": 1,
  "capabilities": {
    "count": 20,
    "names": ["AGENT_ORCHESTRATION", "AUDIO", "BUDGET_ENFORCEMENT", ...]
  },
  "runtimes": {
    "count": 9,
    "items": [
      { "name": "AdkAgentRuntime", "module": "modules/adk",
        "language": "java",
        "expected_capabilities": ["AGENT_ORCHESTRATION", ...] },
      ...
    ]
  }
}
```

Two enforcement points consume it:

1. **`scripts/validate-capability-claims.sh`** — wired into pre-push
   Tier 1. Greps `modules/ai/README.md` for tight count patterns
   (`\bAll \d+ runtimes?\b` and similar) and asserts each match equals
   the snapshot count.
2. **`CapabilitySnapshotTest`** in `modules/ai-test` — same logic in pure
   Java, so `mvn test` catches the same drift.

The snapshot itself is committed; PR reviewers see "9 → 10 runtimes" as a
diff hunk without grepping. The `LC_ALL=C` shell forcing in the regen
script ensures bash `sort` matches Java's `String.compareTo` so the JSON
ordering is identical to the JUnit test's `TreeSet<String>` view.

This is structurally the same pattern
[caveman's `evals/snapshots/results.json`](https://github.com/JuliusBrussee/caveman)
uses for token-compression numbers — commit the snapshot to git so CI is
deterministic and free, and any change is reviewable as a diff.

## Drift log — record the *rate*, not just incidents

`.harness/drift-log.md` is append-only. Every time a Claude session
catches itself (or gets caught) saying something that disagrees with the
code, the agent adds a structured row:

| # | Claim | Truth | Slip path | Gate added |
|---|-------|-------|-----------|------------|
| N | what was stated | what the code says | how it bypassed existing gates | the regression-class fix (validator, test, memory update, prose grep) — `none` is a legitimate value |

Bundling log update + gate addition + prose fix in **one commit** makes
each session's impact diff-reviewable. Per Reock, the signal is the
*rate* of entries over time, not the cleanliness of any single one.
Don't gatekeep; better to over-record minor drift than under-record it.

The first 10 entries (seeded the day the log was created) record actual
session events: a memory file claimed "1 Quarkus build step" when the
code had 14; "PENDING" features that had shipped weeks earlier;
off-by-one runtime counts in narrative prose. The 11th entry recorded a
CI-caught regression where a wall-clock test asserted
`observed > limit` but our scheduled-task fix made `observed == limit` a
legitimate trip outcome. That entry's gate column reads "JDK 21/26 CI
matrix caught it within 12 min" — which is **the most honest gate value
of all**: an existing gate worked.

## Two enforcement points for the drift log

The log is structurally append-only. Two layers keep it that way and
keep it populated:

**`scripts/validate-drift-log.sh`** — pre-push Tier 1. Asserts:

1. File exists and parses.
2. ≥1 `## YYYY-MM-DD` section.
3. No future-dated sections.
4. Sections in chronological order (oldest top, newest bottom).
5. Pre-existing sections (older than today) match `origin/main` verbatim.

It does **not** enforce that drift gets *added* — that's the next layer's
job.

**Claude Code `Stop` hook** at `.claude/hooks/check-drift-log.sh`,
registered in `.claude/settings.json`. Fires at session end:

1. Reads transcript path from hook input JSON.
2. Greps for high-precision drift-correction patterns:
   `stale memory`, `\boff-by-one\b`,
   `I (was wrong|claimed)…(but|actual|truth)`,
   `memor… was/is wrong/stale/out of date`,
   `fabricated rule/stat/count/claim`,
   `verified by grep…disagree/contradict/wrong/stale`.
3. If matched **and** `.harness/drift-log.md` was not modified this
   session (working tree, untracked, or last 3 commits), emits
   `{"decision": "block", "reason": "..."}` to force the agent to
   either append an entry or explicitly state the correction was
   trivial.
4. `stop_hook_active=true` short-circuits to no-op so deliberate skips
   don't loop.

Patterns are deliberately narrow to minimize false positives. If a
recurring real correction shape isn't matching, add a new pattern with
concrete real-session evidence — don't loosen existing ones.

## What this looks like in practice

A typical session might go:

1. Claude claims "X is shipped" based on a 30-day-old memory file.
2. ChefFamille (or `git grep` self-catch) says "verified by grep — that
   class doesn't exist on `main`".
3. Claude reads the actual source, confirms the drift.
4. Claude appends an entry to `.harness/drift-log.md` documenting the
   claim, truth, slip path, and what gate was added.
5. Claude bundles the log entry + any prose fix + the gate (e.g., a
   regex pattern in `validate-capability-claims.sh`) into one commit.
6. Pre-push Tier 1 runs both validators in <1s; commit lands.
7. At session end the Stop hook checks the transcript: drift language
   present, log file modified, no block.

Without the hook, session 2 of the same day forgets and makes the same
class of claim again. With the hook, the agent is re-engaged before the
session can end, and either logs or explicitly states "trivial — not
worth logging" (the hook then no-ops via `stop_hook_active`).

## What this is *not*

- **Not a replacement for code review.** The validators only check
  prose-vs-snapshot agreement and structural hygiene. They don't catch
  semantic bugs, performance regressions, or architectural mistakes.
- **Not a utilization metric.** We don't count "% of commits AI-authored"
  or "tokens spent per feature". Those measures invite Goodhart's Law.
- **Not a substitute for verification at session start.** The
  `feedback_drift_log.md` memory rule says: re-verify against current
  code before quoting any memory file older than the most recent
  CHANGELOG bump. The drift log records what slipped past that rule;
  the rule itself is the primary defense.

## Adopting the pattern in your project

The shape is small enough to copy. Concretely, for a project with an
LLM-facing agent integration:

1. **Pick one or two count claims you make in your README that have
   gone wrong before.** Runtime count, capability count, sample count,
   backend count — anything quantitative that you've shipped wrong.
2. **Build a snapshot** parsed from canonical source. JSON, committed
   to git, regenerated by a single shell script. Add `LC_ALL=C` so
   sort is deterministic across hosts.
3. **Add one validator** that greps your README for those count claims
   and asserts against the snapshot. Wire it into your pre-push hook.
4. **Add an append-only drift log** with one row per caught
   hallucination. Don't stress about the schema — `claim`, `truth`,
   `slip path`, `gate` is enough.
5. **Add a Claude Code Stop hook** (or your agent runtime's equivalent)
   that greps the transcript for drift-correction language and blocks
   session end if the log wasn't updated. Use narrow patterns; broad
   patterns cause false-positive loops.

That's the whole pattern. Roughly 500 lines of bash + 250 lines of Java
in our case. Lower bound for any project: the snapshot + one validator,
maybe 100 lines, gives you the diff-reviewable curve.

## Further reading

- Justin Reock, *AI-Assisted Engineering* —
  [InfoQ talk](https://www.infoq.com/presentations/ai-assisted-engineering/),
  2026-05. The DX measurement framework (utilization vs. impact vs. cost)
  and the Goodhart's Law warning.
- [`walkinglabs/learn-harness-engineering`](https://github.com/walkinglabs/learn-harness-engineering)
  — the five-subsystem framework (Instructions, State, Verification,
  Scope, Lifecycle). Treats the harness as engineering work rather than
  configuration.
- [`juliusbrussee/caveman`](https://github.com/JuliusBrussee/caveman) —
  the snapshot-as-source-of-truth pattern with a three-arm
  baseline/control/treatment eval methodology. Inspired the
  diff-reviewable shape of `capabilities.snapshot.json`.
- Atmosphere's
  [`.harness/README.md`](https://github.com/Atmosphere/atmosphere/blob/main/.harness/README.md)
  — operator manual for the directory.
