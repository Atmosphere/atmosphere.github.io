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
the AST against a declarative policy, and **only verified plans
dispatch**. Atmosphere refuses bad plans before any tool fires — the
same mechanical reasoning that makes parameterised SQL safe.

The pattern was introduced by Erik Meijer in
[*Guardians of the Agents*, Communications of the ACM, January 2026](https://cacm.acm.org/practice/guardians-of-the-agents/);
the [metareflection/guardians](https://github.com/metareflection/guardians)
Python implementation is the reference we modelled the core on. Atmosphere
keeps Meijer's contract and goes substantially further — a six-verifier chain,
static taint dataflow, capability least-authority, two interchangeable SMT
backends, and a deterministic GOAP planner — see
[Beyond *Guardians of the Agents*](#beyond-guardians-of-the-agents).

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
// atmosphere-verifier (allowlist, well-formed, capability, taint,
// automaton, smt) — no manual chain composition.
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

Six built-in verifiers, all auto-discovered via `ServiceLoader`:

| Priority | Verifier | What it refuses |
|---|---|---|
| 10 | `AllowlistVerifier` | Plans naming tools not in `Policy.allowedTools()` *or* not in the runtime `ToolRegistry` (catches deployment drift both ways) |
| 20 | `WellFormednessVerifier` | Forward references — a `SymRef` used before the step that produces its binding (def-before-use) |
| 25 | `CapabilityVerifier` | Plans calling tools whose `@RequiresCapability` declarations are not subsumed by `Policy.grantedCapabilities()` (least-authority) |
| 30 | `TaintVerifier` | Dataflow that routes a `TaintRule.sourceTool()` output (incl. transitively, through intermediate bindings) into the rule's `sinkParam` |
| 40 | `AutomatonVerifier` | Tool-call sequences that drive a `SecurityAutomaton` into an error state ("must authenticate before fetch", "finalize is terminal") |
| 200 | `SmtVerifier` | Numeric invariants over symbolic tool-call data flow via the `SmtChecker` SPI — a real SMT backend ships as `atmosphere-verifier-smt` (SMTInterpol by default, Z3 opt-in). Falls back to a no-op only when that module is absent. See [SMT and Z3 invariants](#smt-and-z3-invariants) below. |

Each verifier is a pure function over `(Workflow, Policy, ToolRegistry)`
and contributes a `VerificationResult`; `PlanAndVerify` aggregates them
via `VerificationResult.merge` so callers get the full violation list,
not just the first failure.

---

## How each verifier works

These are classic program-analysis techniques applied to the LLM's plan instead
of to source code. The two non-trivial ones:

**`TaintVerifier` — forward dataflow taint analysis.** *Taint analysis* tracks
which values are derived from an untrusted source. The verifier maintains a
taint environment, `Map<binding, Set<sourceTool>>`, and walks the plan's steps
in order. For each call it does three things, **in this order**: (1) **sink-check
first** — if the call's tool is a rule's sink and its forbidden `sinkParam` is a
`SymRef` into a binding already tainted by that rule's source (e.g. an
`fetch_emails` result reaching `send_email.body`), emit a violation; (2)
**propagate** — union the taint of every `SymRef` argument's referenced binding
into the call's outgoing set, and add the call's own tool if it is itself a
source; (3) **bind** — record that outgoing set under the call's `resultBinding`,
so taint flows **transitively** through intermediate bindings. Sink-checking
*before* propagation is deliberate: a tool that is a source for one rule and a
sink for another still has its inbound flow checked. This is the engine behind
the headline inbox→`send_email` refusal.

**`AutomatonVerifier` — symbolic execution over a security automaton.** A
`SecurityAutomaton` is a finite-state machine (`states`, `transitions`,
`initialState`) that declares legal tool-call orderings ("`authenticate` before
`fetch`", "`finalize` is terminal"). The verifier sets the current state to
`initialState` and walks the plan's calls in order: on each call it finds the
transition matching `(fromState, toolName)`, advances the state, and emits a
violation if the destination is an error state (one violation per automaton). A
call with no matching transition is outside that automaton's vocabulary and
passes. Matching is **first-transition-wins over a single current state** — the
check is deliberately single-path, not a path-enumerating model checker (see
[Scope](#scope)).

**`AllowlistVerifier`, `CapabilityVerifier`, `WellFormednessVerifier`** are the
fully-decidable structural checks: set membership (`tool ∈ Policy.allowedTools ∩
ToolRegistry` — drift in *either* direction fails), capability subsumption (each
tool's `@RequiresCapability` set must be a subset of `Policy.grantedCapabilities()`
— least authority), and *def-before-use* (every `SymRef` must be produced by an
**earlier** step — forward references are rejected).

**`SmtVerifier` → `SmtChecker` SPI.** For numeric properties the structural
checks can't express, the chain delegates to an SMT (*Satisfiability Modulo
Theories*) solver. It encodes the plan's symbolic dataflow plus the **negation**
of each `NumericInvariant` and asks the solver whether that is satisfiable:
**UNSAT** (unsatisfiable) means the invariant holds for **all** runtime values —
proven safe; **SAT** (satisfiable) yields a concrete counterexample and the plan
is refused. `SmtChecker.resolve()` selects the highest-priority backend whose
`isAvailable()` reports *runtime* load success (not mere classpath presence),
falling back to a green no-op (`NoOpSmtChecker`, priority 0) when no real backend
is available — e.g. the optional `atmosphere-verifier-smt` module isn't present.

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

- `Workflow` → ordered `WorkflowStep`s; each step is a `ToolCallNode` (the
  `PlanNode` sealed hierarchy) with a `toolName`, an arguments map, and a
  `resultBinding`. `SymRef` models the `"@binding"` references, resolved by the
  executor **after** verification (`@@` escapes a literal `@`).

**The verifier chain** — each a pure `PlanVerifier` SPI implementation,
`ServiceLoader`-registered and run in priority order:

- `AllowlistVerifier`, `WellFormednessVerifier`,
  `CapabilityVerifier` (with `CapabilityScanner` + the `@RequiresCapability`
  annotation), `TaintVerifier` (with `TaintRule`, the `@Sink` annotation, and
  `SinkScanner`), `AutomatonVerifier` (with `SecurityAutomaton`,
  `AutomatonState`, `AutomatonTransition`).
- Each yields a `VerificationResult` of `Violation`s; `PlanAndVerify` merges
  them via `VerificationResult.merge` so callers see **every** failure, not
  just the first.

**The SMT layer** — `atmosphere-verifier-smt`

- `SmtVerifier` → the `SmtChecker` SPI → `SmtInterpolChecker` (pure-JVM default)
  or `Z3SmtChecker` (native, opt-in), both built on `AbstractJavaSmtChecker`.
  Invariants are `NumericInvariant`s declared on the `Policy`.

**Execution**

- `WorkflowExecutor` resolves `SymRef`s against the run environment and
  dispatches each verified step through a `ToolDispatcher` (default
  `RegistryToolDispatcher` → the `ToolRegistry`).

**Complementary — deterministic planning.** The module also ships a GOAP
planner (`GoapPlanner` / `GoapAction` / `GoapPlanRuntime`): the *never let the
LLM author the plan* path. It computes a provably-reachable workflow from typed
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
shared **Atmosphere Console's Validation tab** (`/atmosphere/console/`,
where `/` redirects). The tab renders the live verifier chain, the
resolved SMT solver, the policy, the plan AST, and a per-verifier
pass/fail breakdown. Boot it and click the four example goals: two pass
and execute (`EXECUTED`), two are refused (`REFUSED`) — one by taint, one
by SMT. The controller behind the tab is covered by the sample's tests.

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
  <groupId>org.sosy-lab</groupId><artifactId>javasmt-solver-z3</artifactId><version>4.0.51</version>
</dependency>
<!-- macOS arm64 (verified). Linux x64 → libz3-x64 / .so; Windows x64 → .dll -->
<dependency>
  <groupId>org.sosy-lab</groupId><artifactId>javasmt-solver-z3</artifactId><version>4.0.51</version>
  <classifier>libz3-arm64</classifier><type>dylib</type>
</dependency>
<dependency>
  <groupId>org.sosy-lab</groupId><artifactId>javasmt-solver-z3</artifactId><version>4.0.51</version>
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

- **Per-verifier** — `AllowlistVerifierTest`, `WellFormednessVerifierTest`,
  `CapabilityVerifierTest`, `TaintVerifierTest`, `AutomatonVerifierTest`: each
  asserts *both* the pass path and the exact `Violation` its verifier must raise.
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
  resolution + dispatch), `VerifyCliTest` / `VerifyCliEmptyChainTest` (exit
  codes, empty-chain behavior).
- **Deterministic planning** — `GoapPlannerTest`, `GoapPlanRuntimeTest`.
- **End-to-end** — `GuardedEmailAgentTest` exercises the console-driven sample
  pipeline (plans that execute *and* plans that are refused).

The whole suite runs on every push as part of the reactor build, and the
attack/clean plan pairs double as a security-regression corpus.

---

## Beyond *Guardians of the Agents*

Meijer's paper establishes the core contract — the LLM emits a symbolic plan, a
static verifier checks it against a policy, and an SMT solver discharges numeric
invariants. `atmosphere-verifier` keeps that contract and extends it on five axes:

- **A verifier *chain*, not just allowlist + SMT.** Five structural verifiers
  compose via `ServiceLoader` — `AllowlistVerifier`, `WellFormednessVerifier`,
  `CapabilityVerifier` (least-authority), `TaintVerifier` (static `@Sink`
  dataflow), and `AutomatonVerifier` (call-ordering) — plus the `SmtVerifier`
  numeric layer. Each is independently pluggable, and the chain aggregates **every**
  failure into one violation list rather than stopping at the first.
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
- **A consumable module, not a one-off script.** The chain ships as
  `atmosphere-verifier` behind a `PlanAndVerify` facade and is consumed three
  ways: a CLI (`VerifyCli`), the Atmosphere **Console Validation tab** (the admin
  `VerifierController`, auto-configured by the Spring Boot starter), and a worked
  sample (`spring-boot-guarded-email-agent`). And it's native Java, not Python.

---

## Scope

The shipped verifiers are deliberately conservative. These are the boundaries of
what the chain decides — stated as facts, not a roadmap:

- **The plan AST is linear** — `PlanNode` is a sealed interface that permits only
  `ToolCallNode`; the grammar has no conditional or loop nodes, so every verifier
  reasons over a straight-line sequence of calls.
- **Taint and `SymRef` resolution are shallow** — a `SymRef` nested inside a
  list/map argument is not unwrapped. The executor shares this boundary, so a
  reference the taint walk can't see through is one the executor won't dereference
  either; the two stay consistent rather than the analysis going blind behind the
  executor's back.
- **Automaton checking is single-path** — the verifier advances a single current
  state by first-matching transition and refuses any plan that reaches an error
  state. It does not enumerate paths, treat multiple matching transitions
  nondeterministically, or decide temporal (LTL/CTL) liveness properties.
- **SMT is linear integer arithmetic** — the `atmosphere-verifier-smt` backend
  proves numeric invariants over symbolic tool-call arguments. Real and
  bit-vector theories, and loop-carried cost/budget proofs, are out of scope.
- **Plans are closed** — every binding is produced by a step; there is no
  separate "external inputs" section, so a reference to an externally-supplied
  env key fails well-formedness by design.

Within these boundaries the structural and SMT guarantees cover the canonical
prompt-injection and over-privilege attack classes the verifier is built for.

---

## References

- Erik Meijer. [*Guardians of the Agents*](https://cacm.acm.org/practice/guardians-of-the-agents/).
  Communications of the ACM, January 2026. DOI [10.1145/3777544](https://dl.acm.org/doi/10.1145/3777544).
- [metareflection/guardians](https://github.com/metareflection/guardians) —
  the Python reference implementation.
- Atmosphere implementation in [`modules/verifier/`](https://github.com/Atmosphere/atmosphere/tree/main/modules/verifier).
- End-to-end sample: [`spring-boot-guarded-email-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-guarded-email-agent).
