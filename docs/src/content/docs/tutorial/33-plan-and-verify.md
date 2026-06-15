---
title: "Plan-and-Verify — atmosphere-verifier"
description: "Static verification of LLM-emitted tool-call workflows — refuse unsafe plans before any tool fires. Atmosphere's implementation of the Meijer Guardians of the Agents pattern."
---

Most agent frameworks dispatch each LLM-emitted tool call individually,
evaluating safety after the model has already decided what to call. That
is the security posture of string-concatenated SQL — every query is
"validated" by the LLM, and every prompt-injection attempt that bypasses
that mental check goes straight to the database.

`atmosphere-verifier` flips it. The LLM emits a JSON workflow describing
the entire intended sequence, a deterministic verifier chain runs over
the plan's abstract syntax tree (AST) — the structured, in-memory tree of
typed nodes the JSON parses into — against a declarative policy, and
**only verified plans dispatch**. Atmosphere refuses bad plans before any tool fires — the
same mechanical reasoning that makes parameterised SQL safe.

The pattern was introduced by Erik Meijer in
[*Guardians of the Agents*, Communications of the ACM, January 2026](https://cacm.acm.org/practice/guardians-of-the-agents/).
`atmosphere-verifier` is an independent, native-Java implementation of that
pattern — it keeps Meijer's contract and goes substantially further: a
seven-verifier chain, data-dependent branches proved on both arms, deep taint
dataflow, capability least-authority, two interchangeable SMT backends, a
deterministic GOAP planner, and a fail-closed human-in-the-loop gate — see
[Beyond *Guardians of the Agents*](#beyond-guardians-of-the-agents).

## The pipeline at a glance

The LLM never calls a tool directly. It proposes a whole plan; that plan is
parsed into an AST, run through the verifier chain in priority order, and only
dispatched if **every** verifier passes. Any violation refuses the plan before
the first tool fires.

```mermaid
flowchart TD
    LLM["LLM emits a JSON workflow<br/>(the entire intended plan)"]
    Parse["WorkflowJsonParser<br/>builds the immutable, sealed AST"]
    LLM --> Parse --> Chain

    subgraph Chain["Verifier chain — ServiceLoader, priority order"]
        direction TB
        V1["StructureVerifier · 5<br/>control-flow gate"]
        V2["AllowlistVerifier · 10<br/>tool allowlist + registry"]
        V3["WellFormednessVerifier · 20<br/>def-before-use"]
        V4["CapabilityVerifier · 25<br/>least-authority"]
        V5["TaintVerifier · 30<br/>dataflow taint"]
        V6["AutomatonVerifier · 40<br/>call-ordering FSM"]
        V7["SmtVerifier · 200<br/>numeric invariants (SMT)"]
        V1 --> V2 --> V3 --> V4 --> V5 --> V6 --> V7
    end

    Chain --> Gate{"All verifiers pass?"}
    Gate -->|yes| Run["WorkflowExecutor<br/>resolves @refs and dispatches the tool calls"]
    Gate -->|no| Refuse["REFUSED<br/>no tool ever fires — full violation list returned"]

    classDef refuse fill:#fdecec,stroke:#e02424,color:#9b1c1c;
    classDef pass fill:#e9f6ec,stroke:#2f9e44,color:#1b4332;
    class Refuse refuse;
    class Run pass;
```

---

## 30-second quickstart

Add `atmosphere-verifier` to your project, declare a `Policy`, and run
through `PlanAndVerify` instead of dispatching tool calls directly:

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-verifier</artifactId>
    <version>${atmosphere.version}</version>
</dependency>
```

```java
// Tools are plain @AiTool methods; the security property is co-located
// on the parameter that must not receive tainted data.
public class EmailTools {

    @AiTool(name = "fetch_emails", description = "Fetch unread emails")
    public String fetchEmails(@Param("folder") String folder) { ... }

    @AiTool(name = "send_email", description = "Send an email")
    public String sendEmail(
            @Param("to") String to,
            @Param("body")
            @Sink(forbidden = {"fetch_emails"}) String body) { ... }
}

// One policy declaration. SinkScanner derives the dataflow rules from
// the @Sink annotations so the policy and the code are single-sourced.
Policy policy = new Policy(
        "email-policy",
        Set.of("fetch_emails", "send_email"),
        SinkScanner.scan(EmailTools.class),
        List.of());

// Wire it up. ServiceLoader picks up every PlanVerifier shipped in
// atmosphere-verifier (structure, allowlist, well-formed, capability,
// taint, automaton, smt) — no manual chain composition.
PlanAndVerify pv = PlanAndVerify.withDefaults(agentRuntime, registry, policy);

// Run. Either returns the env produced by the executed plan, or throws
// PlanVerificationException carrying the violation list.
Map<String, Object> env = pv.run(userGoal, Map.of());
```

If the LLM emits a malicious plan that pipes the inbox into the
`send_email` body, `pv.run` throws `PlanVerificationException` with one
`taint` violation on `steps[1].arguments.body` — and `send_email` never
executes. That is the headline guarantee.

---

## What the verifier chain catches

Seven built-in verifiers, all auto-discovered via `ServiceLoader` and run in
priority order:

| Priority | Verifier | What it refuses |
|---|---|---|
| 5 | `StructureVerifier` | Plans containing a `ConditionalNode` under a `LINEAR_ONLY` policy (the default); set `ControlFlowMode.BRANCHING` to admit data-dependent branches |
| 10 | `AllowlistVerifier` | Plans naming tools not in `Policy.allowedTools()` *or* not in the runtime `ToolRegistry` (catches deployment drift both ways) |
| 20 | `WellFormednessVerifier` | Forward references — a `SymRef` (or conditional predicate name) used before the step that produces its binding (def-before-use) |
| 25 | `CapabilityVerifier` | Plans calling tools whose `@RequiresCapability` declarations are not subsumed by `Policy.grantedCapabilities()` (least-authority) |
| 30 | `TaintVerifier` | Dataflow that routes a `TaintRule.sourceTool()` output (transitively, at any `SymRef` depth, through both arms of any branch) into the rule's `sinkParam` |
| 40 | `AutomatonVerifier` | Tool-call sequences that can drive a `SecurityAutomaton` into an error state ("must authenticate before fetch", "finalize is terminal") on any reachable path |
| 200 | `SmtVerifier` | Numeric invariants over symbolic tool-call data flow via the `SmtChecker` SPI — a real SMT backend ships as `atmosphere-verifier-smt` (SMTInterpol by default, Z3 opt-in). Falls back to a no-op only when that module is absent. See [SMT and Z3 invariants](#smt-and-z3-invariants) below. |

Each verifier is a pure function over `(Workflow, Policy, ToolRegistry)`
and contributes a `VerificationResult`; `PlanAndVerify` aggregates them
via `VerificationResult.merge` so callers get the full violation list,
not just the first failure.

---

## How each verifier works

Every check below is a *static* analysis — the kind a compiler or linter runs
over source code — except the input is the LLM's plan AST and nothing executes
during the pass. Four well-understood techniques carry the weight: control-flow
analysis (`StructureVerifier`), dataflow/taint tracking (`TaintVerifier`),
finite-state model checking (`AutomatonVerifier`), and SMT solving
(`SmtVerifier`). The remaining three (`Allowlist`, `Capability`,
`WellFormedness`) are decidable structural checks — set membership and
def-before-use.

**`StructureVerifier` — the control-flow gate.** Runs first (priority 5) and
enforces the policy's `ControlFlowMode`. Under `LINEAR_ONLY` (the default) any
`ConditionalNode` is a violation: the plan must be a flat list of tool calls, so
the static proof covers the *single* sequence that runs — the linear-workflow
model of Meijer's paper. Under `ControlFlowMode.BRANCHING` conditionals are
admitted, and every verifier below — the structural checks *and* the SMT layer —
descends into **both arms** of each branch (the runtime predicate is never trusted
to keep an unsafe arm from firing).

**`TaintVerifier` — forward dataflow taint analysis.** *Taint analysis* tracks
which values are derived from an untrusted source. The verifier maintains a
taint environment, `Map<binding, Set<sourceTool>>`, and walks the steps in order.
For each call, **in this order**: (1) **sink-check first** — if the call's tool
is a rule's sink and a `SymRef` **at any depth** inside the forbidden `sinkParam`
points at a binding already tainted by that rule's source (e.g. an `fetch_emails`
result reaching `send_email.body`), emit a violation; (2) **propagate** — union
the taint of every `SymRef` argument (at any depth) into the call's outgoing set,
plus the call's own tool if it is itself a source; (3) **bind** — record that set
under the call's `resultBinding`, so taint flows **transitively**. At a
`ConditionalNode` each arm is walked over a *deep copy* of the environment and the
two results are **unioned** back (a binding tainted on either arm is tainted
afterward) — a sound over-approximation. This is the engine behind the headline
inbox→`send_email` refusal.

**`AutomatonVerifier` — symbolic execution over a *set* of automaton states.** A
`SecurityAutomaton` is a finite-state machine (`states`, `transitions`,
`initialState`) that declares legal tool-call orderings ("`authenticate` before
`fetch`", "`finalize` is terminal"). The plan is executed symbolically over the
**set** of states the automaton could be in (initially `{initialState}`). On each
call, every current state advances through *all* matching `(fromState, toolName)`
transitions; each transition's guard is evaluated statically in the
[`Condition` grammar](#data-dependent-branches-and-guards) to a **tristate** —
`TRUE` takes the target, `FALSE` blocks it, and `UNKNOWN` (a guard over a value
resolved only at run time) keeps **both** the target *and* the staying state.
Conditional arms are explored from the branch-point state set and unioned. If any
reachable state is an error state the plan is refused. Tracking a state *set*
(not a single path) and splitting on unknown guards is the sound
over-approximation — the verifier never misses an error state a runtime value
could reach.

**`AllowlistVerifier`, `CapabilityVerifier`, `WellFormednessVerifier`** are the
fully-decidable structural checks, each covering both arms of every branch (the
per-call ones via a shared `PlanWalk`, well-formedness by forking branch scope):
set membership (`tool ∈ Policy.allowedTools ∩ ToolRegistry` — drift in *either*
direction fails), capability subsumption (each tool's `@RequiresCapability` set
must be a subset of `Policy.grantedCapabilities()` — least authority), and
*def-before-use* (every `SymRef` **and** every conditional predicate name must be
produced by an **earlier** step — forward references are rejected).

**`SmtVerifier` → `SmtChecker` SPI.** For numeric properties the structural
checks can't express, the chain delegates to an SMT (*Satisfiability Modulo
Theories*) solver. For each `NumericInvariant` it asserts the invariant's
**negation** against the plan's symbolic tool-call arguments and asks the solver
whether that is satisfiable: **UNSAT** (unsatisfiable) means no runtime assignment
violates the invariant — it holds for **all** values, proven safe; **SAT**
(satisfiable) yields a concrete counterexample and the plan is refused.
`SmtChecker.resolve()` selects the highest-priority backend whose `isAvailable()`
reports *runtime* load success (not mere classpath presence), falling back to a
green no-op (`NoOpSmtChecker`, priority 0) when no real backend is available —
e.g. the optional `atmosphere-verifier-smt` module isn't present.

---

## The Workflow AST

> *AST = abstract syntax tree* — the structured, in-memory representation of the
> plan that every verifier reasons over (as opposed to the raw JSON text).

LLM emits this JSON; `WorkflowJsonParser` walks it into an immutable
sealed AST:

```json
{
  "goal": "Summarize my inbox",
  "steps": [
    {
      "label": "fetch",
      "toolName": "fetch_emails",
      "arguments": { "folder": "inbox" },
      "resultBinding": "emails"
    },
    {
      "label": "summarize",
      "toolName": "summarize",
      "arguments": { "input": "@emails" },
      "resultBinding": "summary"
    }
  ]
}
```

`"@emails"` is a symbolic reference — it becomes a `SymRef("emails")`
node in the AST and is resolved against the run environment by
`WorkflowExecutor` only after every verifier passes. A literal string
that legitimately starts with `@` is escaped as `@@`.

The wire format is intentionally flat — no Jackson polymorphism, no
type discriminators. That means any structured-output-capable LLM can
produce conformant plans, and the `verifier` module's compile path
stays Jackson-free.

The AST is a **sealed** hierarchy — `PlanNode permits ToolCallNode, ConditionalNode`
— so every verifier's node-type `switch` is exhaustive and a new node kind cannot
be added without each verifier being updated to handle it.

---

## Data-dependent branches and guards

A plan is a flat list of tool calls by default. A policy that opts into
`ControlFlowMode.BRANCHING` may also contain a **`ConditionalNode`** — a
data-dependent branch:

```json
{
  "label":     "decide",
  "condition": "score >= 80",
  "then":      [ { "label": "approve",  "toolName": "approve",  "arguments": { "id": "@candidate" } } ],
  "otherwise": [ { "label": "escalate", "toolName": "escalate", "arguments": { "id": "@candidate" } } ]
}
```

A conditional is itself a step in the top-level `steps` array, distinguished by
carrying a `condition` (the guard) plus `then` / `otherwise` arms instead of a
`toolName` — the wire format is flat, with no `conditional` wrapper object. The
parser turns it into a `ConditionalNode(predicate, thenSteps, elseSteps)` — a
guard and two arms.
The `predicate` — and every `AutomatonTransition` guard — is written in the
**`Condition` grammar**, a single total comparison:

```
condition := <var> <op> <operand>
<op>      := ==  |  !=  |  <=  |  >=  |  <  |  >
```

The left side is a bound variable; the right side is a number, boolean, quoted or
bare string, or an `@`-reference to another binding. There are no boolean
combinators (`&&` / `||` / `!`) and no arithmetic — a guard is exactly one
comparison.

Crucially the *same* expression is evaluated **two ways**:

- **Statically, at verification time** (`evaluateStatic` → `TRUE` / `FALSE` /
  `UNKNOWN`). When both operands are literally known the guard folds to `TRUE` or
  `FALSE`; when an operand is a `SymRef` resolved only at run time it is `UNKNOWN`,
  and the `AutomatonVerifier` soundly explores **both** successor states.
- **At run time** (`evaluate` → `boolean`). `WorkflowExecutor` evaluates the
  `ConditionalNode` predicate against the resolved environment to pick the `then`
  or `otherwise` arm — but only *after* the whole plan (both arms) has already
  passed verification.

Because every verifier proves **both** arms, a branch can never smuggle an unsafe
call past the chain by hiding it behind a predicate the LLM controls.

---

## Implementation

`atmosphere-verifier` is a small, dependency-light module (the core compile
path is Jackson-free; the optional `atmosphere-verifier-smt` adds the solver).
The moving parts map one-to-one to source under
[`modules/verifier/`](https://github.com/Atmosphere/atmosphere/tree/main/modules/verifier):

**Orchestration**

- `PlanAndVerify` — the entry point. `withDefaults(runtime, registry, policy)`
  composes the `ServiceLoader`-discovered chain; `run(goal, env)` prompts the
  runtime (in plan mode) for a workflow, parses it, runs every verifier, and
  dispatches **only** on a clean result — otherwise it throws
  `PlanVerificationException` carrying the full `Violation` list.
- `PlanPromptBuilder` — builds the plan-mode system prompt that asks the LLM
  for the flat JSON workflow.
- `WorkflowJsonParser` — parses that JSON into the sealed AST and rejects
  malformed plans **at the boundary** (a parse failure is a refusal, not a 500).

**The plan AST** — immutable, sealed, Jackson-free

- `Workflow` → ordered `WorkflowStep`s; each step's node is a `ToolCallNode`
  (`toolName`, arguments map, `resultBinding`) or a `ConditionalNode`
  (`predicate`, `thenSteps`, `elseSteps`) — the sealed
  `PlanNode permits ToolCallNode, ConditionalNode`. `SymRef` models the
  `"@binding"` references, resolved by the executor **after** verification
  (`@@` escapes a literal `@`).

**The verifier chain** — each a pure `PlanVerifier` SPI implementation,
`ServiceLoader`-registered and run in priority order:

- `StructureVerifier` (enforces the policy's `ControlFlowMode` — admitting or
  refusing `ConditionalNode` branches), `AllowlistVerifier`,
  `WellFormednessVerifier`, `CapabilityVerifier` (with `CapabilityScanner` + the
  `@RequiresCapability` annotation), `TaintVerifier` (with `TaintRule`, the
  `@Sink` annotation, and `SinkScanner`), `AutomatonVerifier` (with
  `SecurityAutomaton`, `AutomatonState`, `AutomatonTransition`, and the
  `Condition` guard grammar).
- Each yields a `VerificationResult` of `Violation`s; `PlanAndVerify` merges
  them via `VerificationResult.merge` so callers see **every** failure, not
  just the first.

**The SMT layer** — `atmosphere-verifier-smt`

- `SmtVerifier` → the `SmtChecker` SPI → `SmtInterpolChecker` (pure-JVM default)
  or `Z3SmtChecker` (native, opt-in), both built on `AbstractJavaSmtChecker`.
  Invariants are `NumericInvariant`s declared on the `Policy`.

**Execution**

- `WorkflowExecutor` resolves `SymRef`s against the run environment, evaluates any
  `ConditionalNode` predicate to select an arm, and dispatches each verified step
  through a `ToolDispatcher` — either the default `RegistryToolDispatcher`
  (→ the `ToolRegistry`) or the `GatedToolDispatcher`, which runs every call past a
  fail-closed `ApprovalGate` (human-in-the-loop) before dispatch.

**Complementary — deterministic planning.** The module also ships a GOAP
planner (`GoapPlanner` / `GoapAction` / `GoapPlanRuntime`): the *never let the
LLM author the plan* path. It computes a provably-reachable workflow from declared
pre/post-conditions and feeds it to the **same** verifier chain — so you can
verify an LLM-emitted plan or generate one deterministically, and either way
the chain is the gate.

---

## Where the security property lives

The `@Sink` annotation on the tool parameter is the **entire** policy
declaration for that property:

```java
@AiTool(name = "send_email", description = "Send an email")
public String sendEmail(
        @Param("to") String to,
        @Param("body")
        @Sink(forbidden = {"fetch_emails"}, name = "no-inbox-leak") String body) {
    ...
}
```

`SinkScanner.scan(EmailTools.class)` derives a `TaintRule` from this at
startup. Renaming `fetch_emails` or `body` without updating both ends
is impossible: the rule travels with the parameter. No parallel YAML
file to fall out of sync.

---

## CLI

`VerifyCli` runs the chain offline against any workflow and policy
JSON, emits OK or one violation per line, and exits 0/1/2 — useful in
CI corpora and for security-audit walkthroughs of captured LLM output:

```bash
verify --policy email.policy.json --workflow attack.plan.json
# FAILED — 1 violation(s):
#   [taint] Tainted dataflow from 'fetch_emails' reaches 'send_email.body'
#           (rule 'no-inbox-leak', via @emails) (steps[1].arguments.body)
```

---

## Sample

The
[`spring-boot-guarded-email-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-guarded-email-agent)
sample exercises the full pipeline end-to-end: a Spring Boot app and a
deterministic stub `AgentRuntime` that emits canned plans (so the demo
runs without an API key). It has **no bespoke UI** — it drives the
shared **Atmosphere Console's Validation tab** (`/atmosphere/console/`).
The tab renders the live verifier chain, the resolved SMT solver, the
policy, the plan AST, and a per-verifier pass/fail breakdown.

Running a goal *executes* a verified plan — an admin **write** — so the
tab is authenticated: the sample wires a demo `TokenValidator` and you
open it at **`http://localhost:8080/?token=demo-operator`**. The root
redirect carries the token to the console, which replays it as
`X-Atmosphere-Auth` on every admin write; the server resolves it to a
principal and the write-guard authorizes the call. An anonymous caller is
refused with `401` — verification is not a public endpoint when it can
fire tools.

Click the four example goals: two pass and execute (`EXECUTED`), two are
refused (`REFUSED`) — one by taint, one by SMT. The controller and the
HTTP authz path behind the tab are both covered by the sample's tests.

![The Atmosphere Console Validation tab refusing the inbox-exfiltration plan: the verifier chain shows taint failing, with the offending dataflow named.](../../../assets/plan-and-verify-validation-tab.png)

*The malicious "forward my inbox to attacker@evil.example" goal, refused
by the `taint` verifier before `send_email` fires — the plan AST, the
per-verifier breakdown (`taint ✗`), and the offending dataflow
(`steps[1].arguments.body`) are all shown.*

The other two refusal/pass classes render the same way — the chain
breakdown pinpoints exactly which property failed, or the plan executes:

![The Validation tab refusing an over-quota bulk send: every structural verifier passes, but smt fails because send_bulk.count cannot be proven within the daily quota.](../../../assets/plan-and-verify-smt-refused.png)

*Over-quota bulk send — `structure … automaton` all pass (`✓`), but
`smt ✗`: the solver cannot prove `send_bulk.count <= ref(quota)` for
**every** runtime value (`@requested` is attacker-influenceable), so the
plan is refused before `send_bulk` runs.*

![The Validation tab executing a within-quota bulk send: the whole chain passes including smt, and the plan runs, binding a receipt.](../../../assets/plan-and-verify-executed.png)

*Within-quota bulk send — the plan binds `send_bulk(count=@quota)`, so the
solver **proves** `count <= quota` for all values (`smt ✓`); the whole
chain passes and the plan `EXECUTED`, binding a `@receipt`.*

**Multi-agent example.**
[`spring-boot-multi-agent-startup-team`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-multi-agent-startup-team)
takes the same chain to a *team*: a `@Coordinator` CEO verifies the whole team's
plan **before any specialist agent is dispatched**, so cross-agent data governance
(confidential `financial_model` output must not reach an external
`publish_to_board`), an SMT budget bound (`commit_budget.amount <= ref(runway)`),
and a research-before-finance ordering automaton are enforced on the
*orchestration*, not just one agent's tools — plus the fail-closed
`GatedToolDispatcher` approval gate on the CEO's consequential action. The
verifier guards the plan; Atmosphere's governance plane gates each dispatch.

---

## SMT and Z3 invariants

The structural verifiers above are finite, decidable checks. The **SMT layer**
proves the one class of property they cannot: a **numeric relationship that must
hold for _all_ runtime values** of a symbolic binding.

The layer is a small chain: `SmtVerifier` → the `SmtChecker` **SPI** →
`SmtInterpolChecker` (the pure-JVM default) **or** `Z3SmtChecker` (native,
opt-in). Both concrete checkers extend `AbstractJavaSmtChecker`, which drives the
chosen solver through [JavaSMT](https://github.com/sosy-lab/java-smt) (SoSy-Lab's
uniform Java API over [SMT-LIB](https://smt-lib.org/) solvers). Invariants are
`NumericInvariant`s declared on the `Policy`, and the whole layer ships in the
optional `atmosphere-verifier-smt` module.

The canonical example is a money-transfer guard. A policy declares "tool
`transfer`, argument `amount`, must be `≤ ref(balance)`". `balance` is symbolic —
its value is whatever the tool returns at run time. The checker asserts the
_negation_ of the invariant and asks the solver whether it is satisfiable:

| Plan passes `amount =` | Negation asserted | Solver | Result |
|---|---|---|---|
| `@balance` (the read value) | `balance > balance` | **UNSAT** | proven safe |
| `@userInput` (unrelated symbol) | `userInput > balance` | **SAT** | counterexample → refused |

Both the `SymRef` argument and the `RefBound` are keyed by binding name, so
passing the read value straight through is exactly what discharges the proof.

Declare invariants on the `Policy`:

```java
Policy policy = Policy.allowlist("payments", "transfer")
    .withNumericInvariants(List.of(
        new NumericInvariant("transfer", "amount", Op.LE, new RefBound("balance")),
        new NumericInvariant("transfer", "amount", Op.LE, new LiteralBound(1000))));
```

### Solver backends

`atmosphere-verifier-smt` ships **two interchangeable backends** behind the SPI;
`SmtChecker.resolve()` auto-selects the highest-priority one that actually loads:

| Backend | Solver | Native lib? | License | Default |
|---|---|---|---|---|
| `SmtInterpolChecker` (100) | SMTInterpol | **No** (pure-JVM) | LGPL-3.0 | ✅ zero-config |
| `Z3SmtChecker` (200) | Z3 | yes (opt-in) | MIT | when natives present |

**[SMTInterpol](https://github.com/ultimate-pa/smtinterpol)** is the zero-config
default — a pure-JVM linear-integer-arithmetic solver that loads on every
OS/architecture (including Apple Silicon) with no native library and runs in CI
unchanged.

**[Z3](https://github.com/Z3Prover/z3)** (Microsoft Research) is faster and
MIT-licensed, but needs native libraries. Enable it by
adding the bindings jar plus the platform native classifiers, then putting the
natives on `java.library.path`:

```xml
<dependency>
  <groupId>org.sosy-lab</groupId><artifactId>javasmt-solver-z3</artifactId><version>4.14.0</version>
</dependency>
<!-- macOS arm64 (verified). Linux x64 → libz3-x64 / .so; Windows x64 → .dll -->
<dependency>
  <groupId>org.sosy-lab</groupId><artifactId>javasmt-solver-z3</artifactId><version>4.14.0</version>
  <classifier>libz3-arm64</classifier><type>dylib</type>
</dependency>
<dependency>
  <groupId>org.sosy-lab</groupId><artifactId>javasmt-solver-z3</artifactId><version>4.14.0</version>
  <classifier>libz3java-arm64</classifier><type>dylib</type>
</dependency>
```

| Platform | classifier (`libz3` / `libz3java`) | type |
|---|---|---|
| Linux x64 | `libz3-x64` / `libz3java-x64` | `so` |
| macOS x64 (Intel) | `libz3-x64` / `libz3java-x64` | `dylib` |
| macOS arm64 (Apple Silicon) | `libz3-arm64` / `libz3java-arm64` | `dylib` |
| Windows x64 | `libz3-x64` / `libz3java-x64` | `dll` |

`Z3SmtChecker.isAvailable()` reports confirmed native-load state — never
classpath presence alone — so when the natives are absent `resolve()`
transparently falls back to SMTInterpol. Both backends run identical proof
logic, so enabling Z3 changes only the solver engine, not the verified
semantics.

**Runnable sample.** [`spring-boot-guarded-email-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-guarded-email-agent)
demonstrates this end-to-end alongside taint tracking — a bulk-send agent where
the solver proves `send_bulk.count <= ref(quota)` or refuses the plan. It drives
the **Atmosphere Console's Validation tab** (`/atmosphere/console/`), which
renders the live verifier chain, the resolved SMT solver, the plan AST, and the
per-verifier pass/fail breakdown for any goal. Scaffold it with
`atmosphere new my-app --template guarded-agent`.

---

## Tests

Every verifier and the orchestrator has a dedicated unit test, and the two SMT
backends are tested against each other so enabling Z3 can never change a
verdict. The suite under
[`modules/verifier/src/test`](https://github.com/Atmosphere/atmosphere/tree/main/modules/verifier/src/test):

- **Per-verifier** — `StructureVerifierTest`, `AllowlistVerifierTest`,
  `WellFormednessVerifierTest`, `CapabilityVerifierTest`, `TaintVerifierTest`,
  `AutomatonVerifierTest`: each asserts *both* the pass path and the exact
  `Violation` its verifier must raise.
- **Branches & guards** — `ConditionalVerificationTest` (every verifier proves
  both arms), `ConditionTest` (the guard grammar + static tristate /
  runtime eval), `AutomatonGuardTest` (guarded transitions, including the
  `UNKNOWN`-splits-both-ways case), `DeepSymRefTest` (taint through nested
  list/map arguments), and `WorkflowJsonConditionalTest` /
  `WorkflowExecutorConditionalTest` (parse + runtime arm selection).
- **Orchestration** — `PlanAndVerifyTest` drives the full chain end-to-end (a
  clean plan executes; a malicious one throws `PlanVerificationException` with
  the expected violation). `PlanAstRoundtripTest` + `WorkflowJsonParserTest` pin
  the JSON ↔ AST contract; `PlanPromptBuilderTest` pins the plan-mode prompt.
- **SMT** — `SmtCheckerTest`, `SmtInterpolCheckerTest`, `Z3SmtCheckerTest`:
  the same invariant resolves identically on both solvers (UNSAT → proven safe,
  SAT → counterexample → refused).
- **Taint plumbing** — `SinkScannerTest` pins that `@Sink` annotations derive
  the correct `TaintRule`s, so the code and the policy stay single-sourced.
- **Execution & CLI** — `WorkflowExecutorTest` (post-verification `SymRef`
  resolution + dispatch), `GatedToolDispatcherTest` (fail-closed approval:
  denied *and* throwing gates both block the tool), `VerifyCliTest` /
  `VerifyCliEmptyChainTest` (exit codes, empty-chain behavior).
- **Deterministic planning** — `GoapPlannerTest`, `GoapPlanRuntimeTest`.
- **End-to-end** — `GuardedEmailAgentTest` (in the `spring-boot-guarded-email-agent`
  sample, not the verifier module) exercises the console-driven pipeline (plans
  that execute *and* plans that are refused).

The whole suite runs on every push as part of the reactor build, and the
attack/clean plan pairs double as a security-regression corpus.

---

## Beyond *Guardians of the Agents*

Meijer's paper establishes the core contract — the LLM emits a symbolic plan, a
static verifier checks it against a policy, and an SMT solver discharges numeric
invariants. `atmosphere-verifier` keeps that contract and extends it on six axes:

- **A verifier *chain*, not just allowlist + SMT.** Six structural verifiers
  compose via `ServiceLoader` — `StructureVerifier` (control-flow gate),
  `AllowlistVerifier`, `WellFormednessVerifier`, `CapabilityVerifier`
  (least-authority), `TaintVerifier` (static `@Sink` dataflow), and
  `AutomatonVerifier` (call-ordering) — plus the `SmtVerifier` numeric layer. Each
  is independently pluggable, and the chain aggregates **every** failure into one
  violation list rather than stopping at the first.
- **Data-dependent control flow, proved on both arms.** The paper's plans are
  straight-line. Atmosphere admits `ConditionalNode` branches under
  `ControlFlowMode.BRANCHING`, and every verifier descends into **both** arms —
  taint forks its environment, the automaton forks its state set, and the SMT
  layer discharges its invariants on calls in either arm; the results are unioned
  — so a branch can never hide an unsafe call behind a predicate the LLM controls.
  `LINEAR_ONLY` (the default)
  keeps the airtight straight-line proof for deployments that don't need branching.
- **Policy single-sourced from code.** `@Sink` and `@RequiresCapability`
  annotations on the `@AiTool` methods *are* the policy; `SinkScanner` and
  `CapabilityScanner` derive the `TaintRule`s and capability map by reflecting
  over those methods, so the code and its security property cannot drift apart —
  there is no parallel policy file to keep in sync.
- **Two interchangeable SMT backends behind an SPI** — pure-JVM **SMTInterpol**
  (priority 100, zero-config, runs on any OS/arch incl. Apple Silicon) and native
  **Z3** (priority 200, faster, MIT) — selected by *confirmed native-load state*
  (`isAvailable()`), not classpath presence, with identical proof semantics.
- **A deterministic alternative to LLM planning.** The bundled **GOAP** planner
  (`GoapPlanner`) computes the shortest plan reaching a goal from declared
  pre/post-conditions and emits a `Workflow` — the *same* AST the chain verifies
  — so you can verify an LLM-emitted plan **or** never let the LLM author one at all.
- **A fail-closed human-in-the-loop gate.** `GatedToolDispatcher` wraps execution
  in an `ApprovalGate`: a tool fires only on an explicit `true`, and a gate that
  denies *or throws* refuses the call (`ApprovalDeniedException`) — defense in
  depth *on top of* the static proof, drop-in interchangeable with the
  auto-dispatching `RegistryToolDispatcher` at wiring time.

All of this ships as a consumable module, not a one-off script: `atmosphere-verifier`
behind a `PlanAndVerify` facade, consumed by a CLI (`VerifyCli`), the Atmosphere
**Console Validation tab** (the admin `VerifierController`, auto-configured by the
Spring Boot starter), and a worked sample (`spring-boot-guarded-email-agent`) —
a native-Java module end to end.

---

## Scope

The chain is deliberately conservative. These are the boundaries of what it
decides — stated as facts, not a roadmap:

- **Control flow is bounded — branches, not loops.** `PlanNode permits
  ToolCallNode, ConditionalNode`; there is no loop or iteration node, so a plan is
  a tree of bounded depth and the both-arms proof always terminates. Under
  `LINEAR_ONLY` (the default) even conditionals are refused.
- **Guards are a single comparison.** The `Condition` grammar is `<var> <op>
  <operand>` with no boolean combinators (`&&` / `||` / `!`) and no arithmetic.
  Richer ordering logic is expressed as automaton *structure* (states and
  transitions), not as a compound guard.
- **Taint reasons over references, not value contents.** `SymRef`s are resolved at
  any depth, but the AST has no string-concatenation or arithmetic nodes — there
  is no sub-value flow (e.g. a substring of a tainted value) for a reference-level
  analysis to model.
- **SMT is linear integer arithmetic.** The `atmosphere-verifier-smt` backend
  proves numeric invariants over symbolic tool-call arguments. Real and
  bit-vector theories, and loop-carried cost/budget proofs, are out of scope.
- **Plans are closed.** Every binding is produced by a step; there is no separate
  "external inputs" section, so a reference to an externally-supplied env key fails
  well-formedness by design.

Within these boundaries the structural and SMT guarantees cover the canonical
prompt-injection and over-privilege attack classes the verifier is built for.

---

## References

- Erik Meijer. [*Guardians of the Agents*](https://cacm.acm.org/practice/guardians-of-the-agents/).
  Communications of the ACM, January 2026. DOI [10.1145/3777544](https://dl.acm.org/doi/10.1145/3777544).
- [metareflection/guardians](https://github.com/metareflection/guardians) —
  the paper's own reference implementation (Python). Atmosphere's implementation
  is independent and shares no code with it.
- Atmosphere implementation in [`modules/verifier/`](https://github.com/Atmosphere/atmosphere/tree/main/modules/verifier).
- End-to-end sample: [`spring-boot-guarded-email-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-guarded-email-agent).
- Multi-agent sample: [`spring-boot-multi-agent-startup-team`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-multi-agent-startup-team) — the chain verifies a coordinator's team plan before any agent runs.
