---
title: "Earning Trust: the Three-Phase Adoption Pattern"
description: "Go from supervised to autonomous without a big-bang rewrite — PermissionMode, @RequiresApproval, AgentIdentity, and guardrails walk you down the ramp"
---

# Earning Trust: the Three-Phase Adoption Pattern

The Dynatrace *2026 Agentic AI Report* calls out the single biggest
blocker to shipping agentic features: teams want autonomy but cannot
take the leap in one step. The recommended pattern is a **three-phase
trust build**:

1. **Preventive** — agent proposes, human decides.
2. **Supervised** — agent acts, human approves the risky subset.
3. **Autonomous** — agent acts, human audits post-hoc.

Atmosphere ships every primitive this pattern needs — and the nice
property is that **moving between phases is a session-scoped config
change, not a code rewrite**. The same `@Agent` class runs in all three
modes. This chapter walks through the full ramp.

## The primitives at a glance

| Primitive | Phase 1 | Phase 2 | Phase 3 |
|-----------|---------|---------|---------|
| [`PermissionMode`](../../reference/permission-mode/) | `PLAN` | `DEFAULT` or `ACCEPT_EDITS` | `BYPASS` |
| [`@RequiresApproval`](../10-ai-tools/) | informational | gates sensitive tools | optional audit only |
| [`AgentIdentity`](../../reference/agent-identity/) | resolves `userId` → `PermissionMode` | same | same |
| [Guardrails](../12-ai-filters/) | PII redaction, length clamp | + drift detection | + ethics gate |
| [`CoordinationJournal`](../../reference/coordination-journal/) | audit log | audit log + flow viewer | audit log + post-hoc review |

Nothing about your `@Agent` implementation changes across phases — only
the `AgentIdentity.permissionMode(userId)` lookup and the guardrail
pipeline evolve.

## Phase 1 — Preventive (the safe start)

You have a refund agent. You do not trust it to actually issue refunds
yet. In Phase 1 the agent **plans** and the human **executes** — the
tool call is shown to the user, never auto-invoked.

### Configure the identity provider

```java
@Bean
public AgentIdentity agentIdentity() {
    var identity = new InMemoryAgentIdentity();
    // Everyone starts in PLAN — agent narrates proposed actions,
    // user clicks "Approve" on every single tool call.
    identity.setDefaultMode(PermissionMode.PLAN);
    return identity;
}
```

### What the user sees

```
> Please refund $500 to customer cust-42
```

```
Atmosphere AI Console
─────────────────────
[ plan ]
  I propose:
    1. Look up customer cust-42 (tool: lookup_customer)
    2. Verify last invoice (tool: find_invoice)
    3. Issue a refund for $500.00 (tool: issue_refund)
  Approve this plan? [Approve] [Deny] [Modify]
```

The model does not invoke any tool until the user clicks **Approve**.
The plan is a `planProposed` frame; the console renders it as a card
with action buttons.

### Why this phase is valuable

- Every tool call is eyes-on — operators see what the agent *wants* to
  do before it happens.
- No blast radius — a wrong plan costs a user click, not a chargeback.
- You are still collecting signal — which plans the user approves
  verbatim, which ones they modify, which ones they deny. This is the
  data you need for Phase 2.

## Phase 2 — Supervised (the productive middle)

After N weeks of Phase 1, the agent's plans are good. Approving them
one-by-one is now friction. In Phase 2 you lift the ceiling: the agent
acts on its own for *safe* tools and only pauses on *risky* ones.

### Mark the risky subset with `@RequiresApproval`

```java
@Agent
public class RefundAgent {

    @AiTool(description = "Look up customer by id")
    public Customer lookupCustomer(String customerId) {
        // read-only — safe, no approval
        return customerRepo.findById(customerId);
    }

    @AiTool(description = "Find the most recent invoice for a customer")
    public Invoice findInvoice(String customerId) {
        // read-only — safe, no approval
        return invoiceRepo.latestFor(customerId);
    }

    @AiTool(description = "Issue a refund to a customer account")
    @RequiresApproval(
        message = "Confirm refund amount and destination.",
        timeoutSeconds = 3600
    )
    public RefundResult issueRefund(String customerId, BigDecimal amount) {
        // mutating, money-moving — always gate
        return paymentProvider.refund(customerId, amount);
    }
}
```

### Drop the identity to `DEFAULT`

```java
identity.setModeForUser("alice@example.com", PermissionMode.DEFAULT);
```

`DEFAULT` mode runs safe tools inline and surfaces approval cards only
for `@RequiresApproval` methods. The user now sees:

```
> Refund $500 to cust-42
```

```
[ running ] lookup_customer(cust-42)            ✓ 120 ms
[ running ] find_invoice(cust-42)               ✓ 240 ms
[ approval required ] issue_refund(cust-42, 500.00)
  Confirm refund amount and destination.
  [Approve] [Deny]
```

Two of three tools ran without a prompt; one — the money-moving one —
still pauses. Friction dropped by 66% without loosening the gate on
the dangerous operation.

### For edit-shaped workloads, use `ACCEPT_EDITS`

If your agent is a coding agent — lots of file writes, occasional
shell calls — use `ACCEPT_EDITS` instead of `DEFAULT`:

```java
identity.setModeForUser("alice@example.com", PermissionMode.ACCEPT_EDITS);
```

`ACCEPT_EDITS` auto-approves write-shaped tools (edits, patches)
but still gates shell, network, and anything marked
`@RequiresApproval`. This matches Claude Code's `acceptEdits` mode
and is the right setting for IDE-style assistants.

### Harden the pipeline with guardrails

Phase 2 is also when you start layering guardrails — cheap defences
that run on every request/response and catch classes of mistakes the
approval gate doesn't catch.

```java
@Bean
public AiGuardrail piiRedactor() {
    // Zero-dep, compliance-friendly: scrubs email/SSN/credit card from
    // both requests and responses. Blocks when configured.
    return new PiiRedactionGuardrail().blocking();
}

@Bean
public AiGuardrail outputLengthDrift() {
    // Fires a Block when the current response is 3σ longer than the
    // rolling window — catches runaway prompts and injection payloads
    // that balloon responses without any specific signature.
    return new OutputLengthZScoreGuardrail(50, 3.0, 10);
}
```

Both guardrails are stateless from the user's perspective; a drift hit
surfaces to the admin plane as a red flow-viewer edge rather than
spamming the user.

## Phase 3 — Autonomous (the eventual steady state)

Eventually the agent has enough reputation that even the risky gate
becomes friction. Phase 3 is "run the whole thing, audit after". You
do **not** get here by deleting the primitives — you keep them, you
just change the mode and rely on the journal for after-the-fact review.

### Flip the mode

```java
// Only for trusted service accounts / back-office batch jobs.
identity.setModeForUser("batch-refund-processor", PermissionMode.BYPASS);
```

`BYPASS` auto-approves every tool. **It must be explicitly opted into**
— the default stays fail-closed. This is Correctness Invariant #6
(Security: default deny). If you typo the mode name, the session falls
back to `DEFAULT`, not `BYPASS`.

### Keep the journal

`CoordinationJournal` records every tool call, every dispatch, every
failure. In Phase 3 the journal replaces the approval modal as the
primary oversight surface:

- The admin plane's **flow viewer** (`/__admin/flow`) renders the
  journal as an agent-to-agent graph — nodes are agents, edges are
  dispatch counts with success/failure/latency badges.
- The viewer is scoped by time window (`?lookbackMinutes=60`) or by
  run id (`/__admin/flow?coordinationId=coord-123`).
- Wire an `AgentLifecycleListener` to export events to your SIEM
  — every tool call lands there with timestamp, agent id, tool name,
  arguments, and result.

### Keep `@RequiresApproval` too

Even in `BYPASS`, you can keep `@RequiresApproval` on the most
destructive operations as an *audit tag*. When the mode is `BYPASS`,
the gate is skipped at runtime but the annotation still marks those
events as "was sensitive" in the journal — useful for compliance
reports.

## The emergency lever: `DENY_ALL`

One more mode deserves its own section. `PermissionMode.DENY_ALL` is
the kill switch — the agent can still respond in text, but **no tool
executes**. Flip any user or the global default to `DENY_ALL` and the
blast radius drops to zero without tearing the integration out.

```java
// An incident pages the on-call team. They hit the kill switch.
identity.setDefaultMode(PermissionMode.DENY_ALL);
```

This is the lever to reach for when you see an agent behaving badly
and you need the damage to stop *now*, before the post-mortem starts.
The agent keeps answering questions; it just cannot act.

## Instrumentation: how do you know it's time to graduate?

Phase transitions are data-driven, not calendar-driven. The metrics
that matter:

- **Approval accept rate** — the fraction of `ApprovalRequired` cards
  that the user clicks Approve on. If a tool sits at >95% for four
  weeks, it's a candidate to drop from `@RequiresApproval`.
- **Guardrail hit rate** — how often the PII/drift/ethics guardrails
  fire. A falling rate means the model's output distribution is
  stabilizing — a rising rate is a trust regression and a reason to
  *de-escalate* (Phase 2 → Phase 1).
- **Journal anomaly count** — runs that failed, timed out, or hit
  `ApprovalTimeoutException`. Declining = good. Stagnant = promote.
- **MTTR on incidents where the agent was in the chain** — if the
  agent is on the fast path of an incident, you do not promote.

These numbers come out of `CoordinationJournal` + the drift
guardrail's exposed counters — no external tooling required.

## Reversibility: Phase 3 → Phase 2 → Phase 1

The ramp is not one-way. A production incident — a drift hit, a bad
deploy, a regulatory change — can drop an identity back to `PLAN`
without a deploy:

```java
// Compliance audit starts; revert power users to supervised mode
// for the duration of the review.
identity.setModeForUser("alice@example.com", PermissionMode.PLAN);
```

Because the mode is session-scoped and consulted at every tool call
(in `ToolExecutionHelper`), the effect is immediate. No agent restart,
no connection drop. Existing approval-pending cards stay pending;
new requests honor the new mode on their first tool call.

## Putting it together: a quarterly cadence

One pattern that works in practice:

- **Quarter 1**: Launch in `PLAN`. Every user in the pilot group sees
  every plan. Collect approval stats.
- **Quarter 2**: Graduate the pilot to `DEFAULT` with
  `@RequiresApproval` on the top 20% of tools by risk. Add PII and
  drift guardrails. Keep the dashboard open.
- **Quarter 3**: Split users into cohorts — power users move to
  `ACCEPT_EDITS`, new users start at `DEFAULT`. Keep collecting.
- **Quarter 4**: Service accounts and back-office jobs move to
  `BYPASS`. Human-facing sessions stay at `DEFAULT` / `ACCEPT_EDITS`.
  The kill switch (`DENY_ALL`) is wired into your incident runbook.

At the end of a year you have a fully-autonomous agent for the jobs
where autonomy pays off, a supervised agent for the jobs where humans
add value, and a kill switch for when something goes wrong. All from
the same `@Agent` class, driven by config.

## See also

- [PermissionMode Reference](../../reference/permission-mode/) — the
  enum and its semantics
- [AgentIdentity Reference](../../reference/agent-identity/) — resolver
  contract and the `InMemoryAgentIdentity` reference impl
- [Durable HITL Workflows](../24-durable-hitl/) — surviving a restart
  while parked on an approval gate
- [AI Filters / Guardrails](../12-ai-filters/) — `PiiRedactionGuardrail`,
  `OutputLengthZScoreGuardrail`, and the `AiGuardrail` SPI
- [Observability](../18-observability/) — wiring the
  `CoordinationJournal` to OpenTelemetry and SIEM
