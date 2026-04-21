---
title: "OWASP Agentic AI Top-10 — Atmosphere Evidence Matrix"
description: "Self-assessment against OWASP's December 2025 Agentic AI Top 10 with evidence pointers per row, CI-pinned so marketing copy cannot drift from the code."
---

The [OWASP Agentic AI Top 10](https://genai.owasp.org/resource/agentic-ai-top-10/) (December 2025) is now a vendor-qualification taxonomy. Procurement RFPs ask "which rows does your framework cover?" — silent or imprecise answers cost deals. Atmosphere ships a self-assessment matrix with **CI-pinned evidence pointers** per row: every claim points at a real class in this repo, and the build fails if the class is renamed or removed.

## The matrix at a glance

| # | Threat | Coverage | Key evidence |
|---|---|---|---|
| A01 | **Goal Hijacking** | COVERED | `@AgentScope` + 3 `ScopeGuardrail` tiers + pipeline system-prompt hardening + sample-lint CI |
| A02 | Tool Misuse | PARTIAL | `@RequiresApproval` + MS-YAML rules over `tool_name` |
| A03 | Memory Poisoning | DESIGN | `AiConversationMemory` SPI exists; integrity signing deferred (Phase B1) |
| A04 | Indirect Prompt Injection | PARTIAL | `PiiRedactionGuardrail` response-side scan + scope preamble blunts injected instructions |
| A05 | Cascading Failures | COVERED | `CostCeilingGuardrail` + `OutputLengthZScoreGuardrail` + `CoordinationJournal` |
| A06 | Unauthorized Action | COVERED | `ControlAuthorizer` triple-gate + `AgentIdentity` + `@RequiresApproval` |
| A07 | Output Leakage | COVERED | `PiiRedactionFilter` (stream-level) + `PiiRedactionGuardrail` (turn-level) |
| A08 | Supply Chain Compromise | NOT_ADDRESSED | Phase C (DID + Ed25519 plugin signing) parked pending named ask |
| A09 | Denial of Service | COVERED | `CostCeilingGuardrail` + `PerUserRateLimiter` + `OutputLengthZScoreGuardrail` |
| A10 | No Audit Trail | COVERED | `GovernanceDecisionLog` + `GovernanceTracer` (OTel) + `/api/admin/governance/decisions` |

**Tally:** 6 COVERED, 2 PARTIAL, 1 DESIGN, 1 NOT_ADDRESSED.

The matrix is the shipped truth — no rounding. Deliberate use of `PARTIAL`, `DESIGN`, and `NOT_ADDRESSED` documents what Atmosphere does and doesn't claim, so RFP answers stay defensible.

---

## Reading the matrix

Every row carries a `notes` field explaining why the coverage level was chosen. For example, A02 is `PARTIAL` because:

> PARTIAL because the tool-name context bridging is operator-wired (put `tool_name` in `AiRequest.metadata()`) rather than injected by the framework at dispatch. A follow-up auto-wires `tool_name` from `ToolExecutionHelper`.

Reviewers can trust this more than a bare "Covered" checkmark: they see the condition under which the coverage holds and the exact gap to watch.

---

## CI pin — how drift gets caught

`OwaspMatrixPinTest` walks the matrix at test time, resolves every `Evidence.evidenceClass()` and `Evidence.testClass()` to a source file in `modules/` or `samples/`, and throws a descriptive `AssertionError` on any missing reference:

```
OWASP matrix evidence references classes that no longer exist. Either
restore the class, update OwaspAgenticMatrix.MATRIX, or downgrade the
row's coverage. See docs/governance-policy-plane.md.
  A02 — evidence class missing: org.atmosphere.ai.tool.ToolExecutionHelper
```

This closes what v4 §4 flagged as the real risk of the self-assessment: **organizational discipline**. The CI gate is non-negotiable — when a marketing-adjacent surface wants to round `Partial` up to `Covered`, the gate must fail the PR and the decision must be "revise the claim, not bypass the gate."

---

## HTTP endpoint

`GET /api/admin/governance/owasp` returns the matrix as JSON:

```bash
curl -s http://localhost:8080/api/admin/governance/owasp | jq
```

```json
{
  "framework": "OWASP Agentic AI Top 10 (December 2025)",
  "total_rows": 10,
  "coverage_counts": { "COVERED": 6, "PARTIAL": 2, "DESIGN": 1, "NOT_ADDRESSED": 1 },
  "rows": [
    {
      "id": "A01",
      "title": "Goal Hijacking",
      "coverage": "COVERED",
      "evidence": [
        { "class": "org.atmosphere.ai.annotation.AgentScope",
          "test": "org.atmosphere.ai.governance.scope.RuleBasedScopeGuardrailTest",
          "description": "@AgentScope + ScopeGuardrail (3 tiers: rule / embedding / LLM classifier)" }
      ],
      "notes": "Full defense-in-depth: pre-admission classification, system-prompt hardening, sample lint."
    }
  ]
}
```

External compliance tooling (Microsoft's `agt verify`, internal auditors, vendor questionnaires) can consume this endpoint as the machine-readable evidence source.

---

## What's deliberately not claimed

- **Supply Chain (A08)** — Atmosphere does not ship Ed25519 plugin signing or Inter-Agent Trust Protocol today. MS Agent Mesh occupies this space; Atmosphere's Phase C is parked with a trigger (named enterprise ask or partner integration) and a hard review deadline (Q3 2026). If no trigger fires, the row stays `NOT_ADDRESSED` and the matrix continues to say so honestly.
- **Memory Poisoning (A03)** — `DESIGN` because the primitive (`AiConversationMemory`) exists but integrity signing doesn't ship yet. The follow-up is Phase B1 (commitment records with Ed25519 signatures on `AgentState`).
- **Tool Misuse auto-wiring (A02)** — the policy plane can express tool-specific rules, but the framework doesn't yet auto-inject `tool_name` into request metadata at dispatch time. A follow-up closes this gap; until then, `PARTIAL` with operator-wired bridging is accurate.

---

## Related

- **Sample**: [`samples/spring-boot-ms-governance-chat`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ms-governance-chat) — mirrors MS customer-service rule set and exercises most matrix rows live
- **Reference**: [Governance Policy Plane](/docs/reference/governance/) — full API surface
- **Previous chapter**: [@AgentScope & Goal-Hijacking Prevention](/docs/tutorial/31-agent-scope/)
- **Upstream**: [OWASP Agentic AI Top 10](https://genai.owasp.org/resource/agentic-ai-top-10/)
