---
title: "Governance Policy Plane"
description: "Declarative governance for @AiEndpoint — YAML-authored admit/deny/transform policies, including byte-for-byte Microsoft Agent Governance Toolkit YAML parity"
---

`@AiEndpoint` handlers have always had `AiGuardrail` — an imperative Java SPI for PII redaction, cost ceilings, and output-drift detection. This chapter is about the *declarative* layer on top: the **governance policy plane**. Operators author governance in YAML (Atmosphere-native or Microsoft Agent Governance Toolkit format), the framework enforces it, and the admin console renders the live chain.

By the end of this chapter you will:

- Add a YAML policy file to a Spring Boot + Atmosphere app
- Watch the built-in console render policy denials and admits
- Query the live policy chain via `/api/admin/governance/*`
- Drop in Microsoft's own policy YAML and see it enforced verbatim

---

## Two schemas, one engine

Atmosphere's `YamlPolicyParser` accepts **two YAML schemas** that are mutually exclusive per document:

### Atmosphere-native (type-dispatch)

Each policy names a built-in behavior and passes it a config block:

```yaml
version: "1.0"
policies:
  - name: customer-pii-guard
    type: pii-redaction
    config: { mode: redact }
  - name: tenant-budget
    type: cost-ceiling
    config: { budget-usd: 100.00 }
  - name: drift-watcher
    type: output-length-zscore
    config: { window-size: 50, z-threshold: 3.0, min-samples: 10 }
```

Built-in types: `pii-redaction`, `cost-ceiling`, `output-length-zscore`. Register a custom type via `PolicyRegistry.register("my-type", factory)`.

### Microsoft Agent Governance Toolkit (rules-over-context)

```yaml
version: "1.0"
name: production-policy
description: First-match-by-priority over a context dict
rules:
  - name: block-delete-database
    condition: { field: tool_name, operator: eq, value: delete_database }
    action: deny
    priority: 100
    message: "Deleting databases is not allowed"
defaults: { action: allow }
```

`YamlPolicyParser` auto-detects the schema by looking at the root keys (`rules:` → MS branch, `policies:` → native). Everything MS supports is honored: operators (`eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `in`, `contains`, `matches`), actions (`allow`, `deny`, `audit`, `block`), priority-sorted first-match semantic, `defaults.action` fallback.

Conformance is pinned against MS's own example YAMLs — `modules/ai/src/test/resources/ms-agent-os/` holds files copied byte-for-byte from `microsoft/agent-governance-toolkit` at April 2026, and a test fails the build if upstream drifts.

---

## Step 1 — add a policy file

Start from the `ai-chat` template:

```bash
atmosphere new my-app --template ai-chat
cd my-app
```

Create `src/main/resources/atmosphere-policies.yaml`:

```yaml
version: "1.0"
policies:
  - name: chat-pii-guard
    type: pii-redaction
    version: "1.0"
    config:
      mode: redact
```

This declares one policy that redacts PII (email, phone, SSN, credit card, IPv4) from every request before the LLM sees it.

## Step 2 — wire it in

Add a `@Configuration` that loads the YAML at startup and publishes the policies to the framework:

```java
@Configuration
public class PoliciesConfig {
    @Bean
    Object atmospherePolicyPlaneLoader(AtmosphereFramework framework) throws IOException {
        try (var in = new ClassPathResource("atmosphere-policies.yaml").getInputStream()) {
            var policies = new YamlPolicyParser()
                    .parse("classpath:atmosphere-policies.yaml", in);
            framework.getAtmosphereConfig().properties()
                    .put(GovernancePolicy.POLICIES_PROPERTY, policies);
            return policies;
        }
    }
}
```

`AiEndpointProcessor` picks up `POLICIES_PROPERTY` on every `@AiEndpoint`, so the policies now gate every turn across the whole app.

**Alternative for pure Spring deployments:** expose each policy as an `@Component`. `AtmosphereAiAutoConfiguration` bridges Spring-managed `GovernancePolicy` beans onto the same property automatically.

## Step 3 — run and observe

```bash
./mvnw spring-boot:run
open http://localhost:8080/atmosphere/console/
```

Send a prompt containing PII, e.g. `my email is alice@example.com`. The server log fires:

```
PiiRedactionGuardrail: Redacted PII in request (kinds=[email])
```

and the LLM sees `my email is [redacted-email]`. Governance just changed the input before it left the process — no code change in the `@Prompt` handler.

## Step 4 — introspect the live chain

Atmosphere exposes the admin HTTP surface at `/api/admin/governance/*`:

```bash
curl -s http://localhost:8080/api/admin/governance/policies | jq
```

```json
[{
  "name": "chat-pii-guard",
  "source": "classpath:atmosphere-policies.yaml",
  "version": "1.0",
  "className": "org.atmosphere.ai.governance.GuardrailAsPolicy"
}]
```

This endpoint returns **runtime-confirmed state** — what `AiEndpointProcessor` will actually apply — not what the YAML file intends or what Spring beans advertise. That distinction is a Correctness Invariant in Atmosphere (Runtime Truth).

## Step 5 — point MS YAML at the app

Replace the contents of `atmosphere-policies.yaml` with a document authored in the Microsoft Agent Governance Toolkit format:

```yaml
version: "1.0"
name: ms-governance-demo
description: Microsoft Agent Governance Toolkit YAML, unchanged

rules:
  - name: block-destructive-sql
    condition:
      field: message
      operator: matches
      value: '(?i)\bdrop\s+(table|database)\b'
    action: deny
    priority: 100
    message: "Destructive SQL statements are not permitted in this chat."

  - name: block-ssn-shape
    condition:
      field: message
      operator: matches
      value: '\b\d{3}-\d{2}-\d{4}\b'
    action: deny
    priority: 80
    message: "Refusing to process content that looks like a US SSN."

defaults:
  action: allow
```

Restart. The parser auto-detects the schema switch (from `policies:` to `rules:`) and builds an `MsAgentOsPolicy` that evaluates the rules priority-sorted, first-match-wins — exactly MS's semantic, faithfully ported.

Send `please DROP TABLE users` from the console; the browser shows `Error: Denied by policy 'ms-governance-demo': Destructive SQL statements are not permitted in this chat.` with the MS `message:` field surfaced verbatim.

## Step 6 — MS-compatible `/check` decision endpoint

External gateways (Envoy, Kong, Azure APIM) that already speak to MS's `PolicyProviderHandler` ASGI app can point at Atmosphere's `/api/admin/governance/check` without code changes. The payload is MS's `{agent_id, action, context}`:

```bash
curl -X POST http://localhost:8080/api/admin/governance/check \
  -H 'content-type: application/json' \
  -d '{"agent_id":"bot-1","action":"call_tool","context":{"tool_name":"delete_database","message":"please DROP TABLE logs"}}' \
  | jq
```

```json
{
  "allowed": false,
  "decision": "deny",
  "reason": "Destructive SQL statements are not permitted in this chat.",
  "matched_policy": "ms-governance-demo",
  "matched_source": "classpath:atmosphere-policies.yaml",
  "evaluation_ms": 3.27
}
```

The response shape mirrors MS's — operator tooling (Grafana dashboards, gateway rate-limit logic) written against MS's response schema works here unchanged.

---

## Context-map bridge

When an MS rule names `tool_name`, `user_id`, `token_count`, etc. as its `field:`, Atmosphere maps those keys via:

| Rule `field:` | Maps to |
|---|---|
| `message`, `system_prompt`, `model` | `AiRequest` direct fields |
| `user_id`, `session_id`, `agent_id`, `conversation_id` | `AiRequest` direct fields |
| `phase` | `pre_admission` / `post_response` |
| `response` | accumulated response text (post-response phase) |
| *anything else* | `AiRequest.metadata()` entries by exact key |

So `tool_name` lives in metadata — put `request.metadata().get("tool_name")` in the handler before evaluation, and MS's `tool_name` rules fire.

---

## Non-pipeline paths — `PolicyAdmissionGate`

Some `@Prompt` handlers respond locally without invoking `AiPipeline.execute` — demo producers, canned responses, in-process simulators. Those paths normally bypass governance entirely. `PolicyAdmissionGate` fills the gap:

```java
@Prompt
public void onPrompt(String message, StreamingSession session, AtmosphereResource resource) {
    var gate = PolicyAdmissionGate.admit(resource, new AiRequest(message));
    switch (gate) {
        case PolicyAdmissionGate.Result.Denied denied ->
                session.error(new SecurityException(
                        "Denied by " + denied.policyName() + ": " + denied.reason()));
        case PolicyAdmissionGate.Result.Admitted admitted -> {
            session.send("Got it — " + admitted.request().message());
            session.complete();
        }
    }
}
```

Same policy chain, same decision semantics, no pipeline.

---

## Observability

Policy decisions surface through three channels:

- **Logs** — `PiiRedactionGuardrail: Redacted PII in request (kinds=[email])` or `Request denied by policy <name> (source=<uri>, version=<v>): <reason>`.
- **Admin HTTP** — `GET /api/admin/governance/policies` for the live chain; `GET /api/admin/governance/summary` for count + source URIs.
- **Micrometer / OpenTelemetry** — policy decisions flow through the same observability wire as every other `AiPipeline` event.

`AtmosphereAdmin.overview()` also reports `governancePolicyCount` so the root admin dashboard surfaces the plane at a glance.

---

## Try it from the CLI

A complete working sample ships in-tree and can be cloned by the Atmosphere CLI:

```bash
atmosphere new my-governance-app --template ms-governance
cd my-governance-app
./mvnw spring-boot:run
open http://localhost:8090/atmosphere/console/
```

The `ms-governance` template mirrors `samples/spring-boot-ms-governance-chat/` — three Java classes, two YAML files, no custom UI.

---

## Related

- **Reference**: [Governance Policy Plane reference](/docs/reference/governance/) — full SPI catalog, operator semantics, HTTP API schemas.
- **Sample**: [`samples/spring-boot-ms-governance-chat`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ms-governance-chat)
- **Upstream toolkit**: [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit)
- **AI endpoint basics**: [Tutorial 9 — `@AiEndpoint` & StreamingSession](/docs/tutorial/09-ai-endpoint/)
- **Related guardrail APIs**: [Tutorial 12 — AI filters](/docs/tutorial/12-ai-filters/) covers the stream-level PII/content-safety filters that complement policy-plane admission.
