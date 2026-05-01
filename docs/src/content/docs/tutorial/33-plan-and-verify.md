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
[*Guardians of the Agents*, Communications of the ACM, January 2026](https://cacm.acm.org/research/guardians-of-the-agents/);
the [metareflection/guardians](https://github.com/metareflection/guardians)
Python implementation is the reference we modelled this module on. Same
guarantees, native Java API.

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
| 20 | `WellFormednessVerifier` | Forward references to bindings not yet produced by an earlier step |
| 25 | `CapabilityVerifier` | Plans calling tools whose `@RequiresCapability` declarations are not subsumed by `Policy.grantedCapabilities()` (least-authority) |
| 30 | `TaintVerifier` | Dataflow that routes a `TaintRule.sourceTool()` output (incl. transitively, through intermediate bindings) into the rule's `sinkParam` |
| 40 | `AutomatonVerifier` | Tool-call sequences that drive a `SecurityAutomaton` into an error state ("must authenticate before fetch", "finalize is terminal") |
| 200 | `SmtVerifier` | Richer invariants via the `SmtChecker` SPI — Z3-ready; ships with a no-op default until a solver backend is dropped on the classpath |

Each verifier is a pure function over `(Workflow, Policy, ToolRegistry)`
and contributes a `VerificationResult`; `PlanAndVerify` aggregates them
via `VerificationResult.merge` so callers get the full violation list,
not just the first failure.

---

## The Workflow AST

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
sample exercises the full pipeline end-to-end: a Spring Boot app, a
deterministic stub `AgentRuntime` that emits canned plans (so the demo
runs without an API key), a REST endpoint, and a static UI that
renders either the green `EXECUTED` summary or the red `REFUSED`
violation list. Boot it and try the two example buttons; both flows are
covered by Playwright e2e tests.

---

## Limitations (Phase 5 baseline)

The shipped verifiers are intentionally conservative:

- **Shallow taint and shallow SymRef resolution** — a `SymRef` buried
  inside a list/map argument is not unwrapped. Same constraint applies
  uniformly to executor and taint walk so neither can "see through"
  what the other can't.
- **Single-shot automaton execution** — first matching transition wins;
  no path enumeration. Authors writing nondeterministic automata get
  declaration-order semantics until the path-explorer lands.
- **No SMT solver in-tree** — the `SmtChecker` SPI is in place and a
  Z3-backed implementation drops in via `ServiceLoader`. The shipped
  default is a no-op so the chain composition stays uniform.
- **Initial-env bindings must be produced by a step** — references to
  externally-supplied env keys would be flagged by well-formedness; the
  `Workflow` AST doesn't yet declare a separate "external inputs"
  section.

These are tracked for follow-up; the structural guarantees the existing
chain already provides are enough for the canonical prompt-injection
attack class.

---

## References

- Erik Meijer. [*Guardians of the Agents*](https://cacm.acm.org/research/guardians-of-the-agents/).
  Communications of the ACM, Vol. 69 No. 1 (January 2026).
- [metareflection/guardians](https://github.com/metareflection/guardians) —
  the Python reference implementation.
- Atmosphere implementation in [`modules/verifier/`](https://github.com/Atmosphere/atmosphere/tree/main/modules/verifier).
- End-to-end sample: [`spring-boot-guarded-email-agent`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-guarded-email-agent).
