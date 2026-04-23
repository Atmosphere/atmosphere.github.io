---
title: "Governance Policy Plane"
description: "GovernancePolicy SPI, YAML schemas (native + Microsoft Agent Governance Toolkit), PolicyAdmissionGate, /api/admin/governance/* HTTP surface"
---

Declarative governance layered on top of `AiGuardrail`. Loaded from YAML (Atmosphere-native or Microsoft Agent Governance Toolkit format), enforced on every `@AiEndpoint` through `AiPipeline`, queryable via HTTP, and interoperable with the Microsoft `/check` ASGI protocol.

Tutorial: [Governance Policy Plane](/docs/tutorial/30-governance-policy-plane/). Module: `atmosphere-ai`. Admin surface: `atmosphere-admin`.

---

## SPIs

### `GovernancePolicy`

Package: `org.atmosphere.ai.governance`. Core declarative SPI — a named, versioned, source-identified `evaluate(PolicyContext) → PolicyDecision` function.

```java
public interface GovernancePolicy {
    String POLICIES_PROPERTY = "org.atmosphere.ai.governance.policies";

    String name();      // stable identifier for audit trail
    String source();    // yaml:/path/to/file.yaml | classpath:file.yaml | code:<fqn>
    String version();   // semver, ISO date, or content hash — operator choice
    PolicyDecision evaluate(PolicyContext context);
}
```

Implementations MUST be thread-safe, side-effect-free (except metrics / logging), and MUST NOT throw — exceptions fail-closed to `Deny` at every admission seam.

### `PolicyContext`

```java
public record PolicyContext(Phase phase, AiRequest request, String accumulatedResponse) {
    public enum Phase { PRE_ADMISSION, POST_RESPONSE }
    public static PolicyContext preAdmission(AiRequest request);
    public static PolicyContext postResponse(AiRequest request, String accumulatedResponse);
}
```

### `PolicyDecision`

Sealed type:

```java
sealed interface PolicyDecision {
    record Admit() implements PolicyDecision { }
    record Transform(AiRequest modifiedRequest) implements PolicyDecision { }
    record Deny(String reason) implements PolicyDecision { }
    static PolicyDecision admit();
    static PolicyDecision transform(AiRequest r);
    static PolicyDecision deny(String reason);
}
```

`Transform` on the post-response path is non-operational (streamed text is not retroactively rewritable) — the pipeline logs a warning and downgrades to `Admit`.

### `PolicyParser`

Pluggable YAML / Rego / Cedar parser. Discovered via `java.util.ServiceLoader`.

```java
public interface PolicyParser {
    String format();   // "yaml" | "rego" | "cedar"
    List<GovernancePolicy> parse(String source, InputStream in) throws IOException;
}
```

**One implementation ships in-tree:** `YamlPolicyParser` (SnakeYAML `SafeConstructor`, no arbitrary class instantiation). Auto-detects Atmosphere-native vs MS schema by root-key inspection.

### `PolicyRegistry`

Maps YAML `type:` names to factory functions.

```java
var registry = new PolicyRegistry();                               // built-ins pre-registered
registry.register("my-domain-policy", descriptor ->
        new MyDomainPolicy(descriptor.name(), descriptor.source(),
                descriptor.version(), descriptor.config()));
var parser = new YamlPolicyParser(registry);
```

Built-in types:

| `type:` | Wraps | Config keys |
|---|---|---|
| `pii-redaction` | `PiiRedactionGuardrail` | `mode: redact \| block` |
| `cost-ceiling` | `CostCeilingGuardrail` | `budget-usd: <number>` |
| `output-length-zscore` | `OutputLengthZScoreGuardrail` | `window-size`, `z-threshold`, `min-samples` |

### `@AgentScope` + `ScopeGuardrail`

Annotation + SPI for architectural goal-hijacking prevention. See [tutorial 31](/docs/tutorial/31-agent-scope/) for usage.

```java
public @interface AgentScope {
    String purpose() default "";
    String[] forbiddenTopics() default {};
    Breach onBreach() default Breach.POLITE_REDIRECT;
    String redirectMessage() default "";
    Tier tier() default Tier.EMBEDDING_SIMILARITY;
    double similarityThreshold() default 0.45;
    boolean unrestricted() default false;
    String justification() default "";
    boolean postResponseCheck() default false;
    enum Breach { POLITE_REDIRECT, DENY, CUSTOM_MESSAGE }
    enum Tier { RULE_BASED, EMBEDDING_SIMILARITY, LLM_CLASSIFIER }
}

public interface ScopeGuardrail {
    AgentScope.Tier tier();
    Decision evaluate(AiRequest request, ScopeConfig config);
    record Decision(Outcome outcome, String reason, double similarity) { }
    enum Outcome { IN_SCOPE, OUT_OF_SCOPE, ERROR }
}
```

Three tier implementations ship in-tree:

- `RuleBasedScopeGuardrail` — keyword / regex + bundled hijacking probes. Sub-ms. No dependencies.
- `EmbeddingScopeGuardrail` — cosine similarity against purpose vector via `EmbeddingRuntime`. ~5–20ms. **Default tier.**
- `LlmClassifierScopeGuardrail` — zero-shot YES/NO against the resolved `AgentRuntime`. ~100–500ms. Opt-in via `tier = LLM_CLASSIFIER`.

`ScopePolicy` wraps a `ScopeGuardrail` as a `GovernancePolicy` — breach decisions map via `AgentScope.Breach` to `Deny` / `Transform` (rewriting the request message to the redirect text).

**Sample-hygiene CI lint**: `SampleAgentScopeLintTest` walks `samples/` and fails the build on any `@AiEndpoint` missing `@AgentScope` (or lacking a non-blank `justification` when `unrestricted = true`).

**System-prompt hardening**: `AiPipeline` prepends an unbypassable confinement preamble to the system prompt on every turn when any `ScopePolicy` is installed. Even samples that call `session.stream(...)` with a substituted system prompt see the hardening re-applied before the runtime dispatch.

### `PolicyAdmissionGate`

Static utility — runs the policy chain on an `AiRequest` **outside** `AiPipeline`. For code paths that produce responses locally (demo responders, canned replies) and therefore never reach the pipeline.

```java
var result = PolicyAdmissionGate.admit(resource, new AiRequest(message));
switch (result) {
    case PolicyAdmissionGate.Result.Denied denied -> /* session.error(...) */;
    case PolicyAdmissionGate.Result.Admitted admitted -> /* use admitted.request() */;
}
```

Fail-closed — a throwing policy becomes `Denied` with the exception message.

### Adapters

- `GuardrailAsPolicy(AiGuardrail)` — expose any `AiGuardrail` as a `GovernancePolicy`.
- `PolicyAsGuardrail(GovernancePolicy)` — expose any `GovernancePolicy` as an `AiGuardrail`. Used internally by `AiEndpointProcessor` to merge policies into the guardrail list consumed by `AiPipeline`.

---

## YAML schemas

### Atmosphere-native (type-dispatch)

```yaml
version: "1.0"
policies:
  - name: <unique-id>
    type: pii-redaction | cost-ceiling | output-length-zscore | <custom>
    version: "1.0"
    config: { ... }
```

The document `version:` is the fallback used when a policy entry omits its own `version:`.

### Microsoft Agent Governance Toolkit (rules-over-context)

Faithful port of MS's `_match_condition` + `PolicyEvaluator.evaluate` semantics. Documents with a top-level `rules:` sequence trigger the MS branch.

```yaml
version: "1.0"
name: <policy-document-name>
description: <optional>
rules:
  - name: <rule-id>
    condition:
      field: <key>
      operator: eq | ne | gt | lt | gte | lte | in | contains | matches
      value: <scalar | list | regex>
    action: allow | deny | audit | block
    priority: <integer>         # higher wins; pre-sorted descending at load
    message: <surfaced on Deny>
defaults:
  action: allow | deny | audit | block
```

**Operator semantics:**

| Operator | Behavior |
|---|---|
| `eq` / `ne` | Loose equality (numeric cross-type aware — `1 == 1.0`) |
| `gt`, `lt`, `gte`, `lte` | `Comparable`-based ordering |
| `in` | Value appears in target list (target must be a sequence) |
| `contains` | Substring (string context) or membership (collection context) |
| `matches` | Regex via `java.util.regex.Pattern.matcher().find()` — compiled at parse time |

**Action mapping:**

| YAML | `PolicyDecision` |
|---|---|
| `allow` | `Admit` |
| `deny` / `block` | `Deny(message)` |
| `audit` | `Admit` + structured INFO log |

**Context map** — rule `field:` references resolve against:

| Key | Source |
|---|---|
| `message`, `system_prompt`, `model` | `AiRequest` direct fields |
| `user_id`, `session_id`, `agent_id`, `conversation_id` | `AiRequest` direct fields |
| `phase` | `pre_admission` / `post_response` |
| `response` | Accumulated response text (post-response only) |
| *anything else* | `AiRequest.metadata()` entries by exact key |

**Schema exclusivity** — documents that mix `rules:` and `policies:` raise `IOException` at parse time. Pick one.

**Conformance** — `MsAgentOsYamlConformanceTest` parses MS's own example YAMLs (copied unmodified from `microsoft/agent-governance-toolkit@April-2026` under `docs/tutorials/policy-as-code/examples/`) and asserts MS's documented behavior. Upstream schema drift fails the test.

---

## AiPipeline wiring

The canonical `AiPipeline` constructor accepts both guardrails and policies:

```java
new AiPipeline(runtime, systemPrompt, model,
        memory, toolRegistry,
        guardrails, policies, contextProviders,
        metrics, responseType);
```

Pre-admission order: guardrails first, policies second. Exceptions in a policy's `evaluate()` method fail-closed to `Deny` (Correctness Invariant #2). Post-response evaluation merges policies into `GuardrailCapturingSession` via `PolicyAsGuardrail` — one loop, deterministic ordering.

`AiEndpointProcessor` merges policies from three sources with dedup by `name()`:

1. `ServiceLoader<GovernancePolicy>` (for framework-less / Quarkus deployments)
2. Framework-property bag (`POLICIES_PROPERTY` — populated by YAML loaders or Spring auto-config)
3. Annotation-declared classes on `@AiEndpoint(guardrails = {...})` continue to work via `AiGuardrail` unchanged

---

## Spring Boot auto-configuration

`AtmosphereAiAutoConfiguration` bridges Spring-managed beans onto framework properties:

- Every `@Component` / `@Bean` of type `AiGuardrail` → `AiGuardrail.GUARDRAILS_PROPERTY`
- Every `@Component` / `@Bean` of type `GovernancePolicy` → `GovernancePolicy.POLICIES_PROPERTY`

Direct YAML loading (typical pattern):

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

---

## HTTP surface

Exposed by `AtmosphereAdminEndpoint` when `atmosphere-admin` is on the classpath. Wire-compatible with Microsoft Agent Governance Toolkit's `PolicyProviderHandler` ASGI app.

### `GET /api/admin/governance/policies`

Lists the live policy chain.

```json
[
  { "name": "string", "source": "string",
    "version": "string", "className": "string" }
]
```

### `GET /api/admin/governance/summary`

```json
{ "policyCount": 0, "sources": ["string"] }
```

### `GET /api/admin/governance/decisions?limit=N`

Ring-buffered recent `AuditEntry` records (newest first).

```json
[
  {
    "timestamp": "2026-04-21T22:04:08.802Z",
    "policy_name": "scope::SupportChat",
    "policy_source": "annotation:org.example.SupportChat",
    "policy_version": "1.0",
    "decision": "deny",
    "reason": "message matched built-in hijacking probe: 'write python code'",
    "evaluation_ms": 0.42,
    "context_snapshot": { "phase": "pre_admission", "message": "write python code to sort an array" }
  }
]
```

### `GET /api/admin/governance/owasp`

OWASP Agentic AI Top 10 self-assessment — full matrix with coverage + evidence pointers per row. Pairs with external `agt verify`-style compliance tooling.

### `POST /api/admin/governance/check`

MS `/check`-compatible decision endpoint.

Request:

```json
{ "agent_id": "string", "action": "string", "context": { "<key>": "<value>" } }
```

Response:

```json
{
  "allowed": true,
  "decision": "allow | deny | transform",
  "reason": "string",
  "matched_policy": "string | null",
  "matched_source": "string | null",
  "evaluation_ms": 0.0
}
```

Maps `agent_id` → `AiRequest.agentId`, each `context` entry onto `AiRequest.metadata()`. External gateways pointed at MS's ASGI app work against Atmosphere without payload translation.

### `GET /api/admin/governance/health`

Operator snapshot aggregating kill-switch state, dry-run counters, SLO
status, and per-policy hash fingerprints. Admin dashboards use this as a
single-fetch status endpoint.

### `GET /api/admin/governance/agt-verify`

Compliance export shaped for Microsoft's `agt verify` CLI — cross-framework
findings (OWASP Agentic Top 10 + EU AI Act + HIPAA + SOC2) with per-row
evidence pointers and a per-framework coverage summary. Round-trips into
tooling that already consumes MS's Agent Compliance package format.

### `POST /api/admin/governance/reload`

Hot-reload a policy wrapped in `SwappablePolicy`. Body: `{swapName, yaml}`;
response reports outgoing + incoming delegate identity.

### `POST /api/admin/governance/kill-switch/{arm,disarm}`

Operator break-glass. Armed state halts every admission decision in
sub-millisecond time. Live verification on the startup-team sample
shows the same prompt that admits at 0.11ms deny at 0.09ms while armed
— no redeploy, no restart.

```bash
curl -X POST http://localhost:8080/api/admin/governance/kill-switch/arm \
     -H 'Content-Type: application/json' \
     -d '{"reason":"incident-42","operator":"oncall"}'
```

---

## Multi-agent governance

Single-endpoint scope is half the story — cross-agent dispatch needs the
same enforcement. Atmosphere's `FleetInterceptor` SPI (in
`atmosphere-coordinator`) gates every outbound `AgentCall` before it
leaves the coordinator.

### `FleetInterceptor` SPI

```java
public interface FleetInterceptor {
    Decision before(AgentCall call);
    sealed interface Decision {
        record Proceed() implements Decision {}
        record Rewrite(AgentCall modifiedCall) implements Decision {}
        record Deny(String reason) implements Decision {}
    }
}
```

Install via `AgentFleet.withInterceptor(interceptor)`. Denies synthesize
a failed `AgentResult` without consuming the transport hop.

### `GovernanceFleetInterceptor`

Ready-made bridge that runs the full `GovernancePolicy` chain on every
dispatch. A coordinator mistakenly dispatching "write Python" to its
research agent gets denied at the fleet boundary, not just at the
user-facing entry.

```java
var governed = fleet.withInterceptor(new GovernanceFleetInterceptor(policies));
var research = governed.agent("research").call("web_search", args);
```

### Commitment records on cross-agent dispatch

When `JournalingAgentFleet.signer()` is installed and
`CommitmentRecordsFlag.isEnabled()` is true (default off per v4 Phase B1),
every dispatch emits a W3C Verifiable-Credential-subtype record signed
with Ed25519. The admin **Commitments** tab renders verified records with
a ✓ badge. Unique pairing with durable sessions: the signed audit trail
survives pause-and-resume across the `CheckpointStore` — demonstrated in
the [checkpoint-agent sample](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-checkpoint-agent).

Enable for a sample deployment:

```java
@Bean CommitmentSigner signer() { return Ed25519CommitmentSigner.generate(); }
@PostConstruct void enable() { CommitmentRecordsFlag.override(Boolean.TRUE); }
```

---

## Samples applied to the 4 goals

| Sample | Goal 1 MS YAML | Goal 2 Scope | Goal 3 Commitments | Goal 4 OWASP |
|---|:-:|:-:|:-:|:-:|
| [spring-boot-ms-governance-chat](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ms-governance-chat) | ✅ | ✅ | — | ✅ |
| [spring-boot-ai-classroom](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ai-classroom) | ✅ | ✅ | — | — |
| [spring-boot-multi-agent-startup-team](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-multi-agent-startup-team) | ✅ | ✅ | ✅ | ✅ |
| [spring-boot-checkpoint-agent](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-checkpoint-agent) | — | — | ✅ | — |
| [spring-boot-mcp-server](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-mcp-server) | — | ✅ | — | ✅ |

Each sample's e2e test boots the real Spring Boot context and asserts
admission decisions at runtime — no mocking at the governance seam.

---

## Audit trail

Every `GovernancePolicy.evaluate` decision emits:

1. **`AuditEntry`** — structured record (policy identity, decision, reason, context snapshot, `evaluation_ms`) ring-buffered by `GovernanceDecisionLog` (default 500 entries). Surfaced via `GET /api/admin/governance/decisions?limit=N`.
2. **OpenTelemetry span** — `governance.policy.evaluate` with attributes `policy.name`, `policy.source`, `policy.version`, `policy.phase`, `policy.decision`, `policy.reason`. Denied / errored spans carry status `ERROR` for Jaeger / Tempo visibility. Reflective classpath detection keeps OTel an optional dependency.
3. **Server log** — structured `Request denied by policy <name> (source=<uri>, version=<v>): <reason>`.

The context snapshot is redaction-safe: message truncated to 200 chars, metadata values coerced to primitives or `toString()`. Long-term retention is operator responsibility — wire to Kafka / Postgres / etc. by reading `GovernanceDecisionLog.installed().recent(N)` on a schedule.

## OWASP Agentic Top-10 matrix

`OwaspAgenticMatrix.MATRIX` is a CI-pinned self-assessment (see [tutorial 32](/docs/tutorial/32-owasp-agentic-matrix/) for the full reading and rationale). `OwaspMatrixPinTest` fails the build if any referenced `Evidence.evidenceClass` or `Evidence.testClass` no longer exists. Served over HTTP at `GET /api/admin/governance/owasp`.

Current tally: 6 COVERED, 2 PARTIAL, 1 DESIGN, 1 NOT_ADDRESSED. Honest reporting is the point — silent rounding defeats the self-assessment.

## Correctness invariants

| Invariant | How honored |
|---|---|
| **#2 Terminal-path completeness** | Policy exceptions fail-closed to `Deny` at every admission seam |
| **#5 Runtime truth** | `GovernanceController` reports installed policies, not classpath or YAML intent |
| **#7 Mode parity** | `PolicyPlaneSourceParityTest` — same admission decision whether policies came from YAML, code, or ServiceLoader |

---

## Related

- Tutorial: [Governance Policy Plane](/docs/tutorial/30-governance-policy-plane/)
- Sample: [`samples/spring-boot-ms-governance-chat`](https://github.com/Atmosphere/atmosphere/tree/main/samples/spring-boot-ms-governance-chat)
- In-tree detailed docs: [`docs/governance-policy-plane.md`](https://github.com/Atmosphere/atmosphere/blob/main/docs/governance-policy-plane.md)
- Module reference: [`modules/ai/README.md`](https://github.com/Atmosphere/atmosphere/blob/main/modules/ai/README.md#governance-policy-plane-phase-a)
- Upstream toolkit: [github.com/microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit)
