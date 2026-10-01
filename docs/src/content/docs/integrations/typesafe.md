---
title: "TypeSafe"
description: "DecisionModel adapter for the TypeSafe System One API — typed choice, score and yes/no answers that carry the provider's probability distribution"
---

# TypeSafe Decision Model Adapter

`atmosphere-ai-decision-typesafe` is a [`DecisionModel`](/docs/reference/decision-models/) over the [TypeSafe](https://docs.typesafe.ai) System One API. TypeSafe's models answer typed questions (choice, score, yes/no) with a probability distribution instead of writing text. The adapter turns a `DecisionRequest` into one `POST /v1/systemone` call and maps each answer to the matching typed `Answer`.

It is not an `AgentRuntime`: it does not stream, chat or call tools. Once it is available it becomes the model behind the decision consumers — the `LLM_CLASSIFIER` injection, scope and moderation tiers, and intent routing.

:::caution[Not in a release yet]
The module is not part of 4.0.71 or any earlier release. This page describes it ahead of the release that includes it.
:::

## What was verified, and how

**No call with a valid TypeSafe API key has been made from the Atmosphere repository.** None was available when the module was written. Everything about successful answers is verified only against fixtures copied from TypeSafe's published documentation:

| Behaviour | Verified against |
|-----------|------------------|
| Request bodies for noul, choice and score (`state`, `model`, `questions.<id>.{type, instructions, criteria}`) | The request examples in `docs.typesafe.ai/api.md`, copied into test fixtures. The one edit: `model` is the pinned `jev-1.13.0` (the adapter's default) where the docs send the moving alias `jev-latest` |
| Answer shapes for noul, choice, score and `usage` | The response examples in `api.md`, copied into test fixtures |
| `GET /v1/models` shape (`{"models":[{"name","description","release_date"}]}`) | The field list in `docs.typesafe.ai/models.md`. The fixture's descriptions and dates are made up |
| **401** for an invalid key, on `/v1/models` and `/v1/systemone` | **Live**, against `api.typesafe.ai` (`TypesafeLiveTest#theRealApiRejectsAnInvalidKey` with `-Dtypesafe.live=true`, plus `curl`) |
| **403** when no key is sent | **Live**, with `curl` |
| 422, 429 and 529 handling | Status codes from `api.md`. The error **bodies** in the fixtures are **assumed** — none was observed. The adapter reads only the status, the retry headers and a best-effort message, so a different body changes the logged detail and nothing else |
| `retry-after-ms` / `Retry-After` header names | TypeSafe's SDK retry reference; not observed live |

The live lane (`.github/workflows/typesafe-decision-live.yml`) runs every question type with a real key plus the invalid-key path. It is **manual dispatch only**, needs the `TYPESAFE_API_KEY` repository secret, and fails rather than passes when the secret is missing. Until someone dispatches it with a key, the successful-answer path is fixture-verified only.

## Maven Coordinates

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-ai-decision-typesafe</artifactId>
    <version>${project.version}</version>
</dependency>
```

The module adds no third-party runtime dependency: the `DecisionModel` SPI, Jackson 3 and SLF4J come from `atmosphere-ai`, and the HTTP client is the JDK's `java.net.http`. It is registered in `META-INF/services/org.atmosphere.ai.decision.DecisionModel`.

## Configuration

A JVM system property wins over the environment variable. The environment variable names are the ones the TypeSafe SDKs read.

| Setting | System property | Environment | Default |
|---------|-----------------|-------------|---------|
| API key | `org.atmosphere.ai.decision.typesafe.api-key` | `TYPESAFE_API_KEY` | none (unavailable) |
| Base URL | `org.atmosphere.ai.decision.typesafe.base-url` | `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` |
| Model | `org.atmosphere.ai.decision.typesafe.model` | `TYPESAFE_DEFAULT_MODEL` | `jev-1.13.0` |

These are JVM system properties and environment variables, not Spring Boot or Quarkus configuration keys.

- **Pinned model by default.** `jev-latest` and `jev-preview` are moving aliases: TypeSafe documents that the answers behind them can change without a change on your side. They are accepted, with an INFO log. Each `DecisionResult.model()` reports the versioned id the API says answered.
- **Base URL.** Scheme and host only, because the adapter appends `/v1/...`. Plain `http` is accepted only for a loopback host, so the key never crosses a network unencrypted.
- **Bad configuration** (a malformed URL or model id, a key with spaces) does not throw from the ServiceLoader constructor. The instance is unavailable and fails every question with `ERROR`; the reason is logged once per distinct message for the JVM.

To configure an instance in code, use the builder. It throws on bad configuration instead:

```java
var model = TypesafeDecisionModel.builder()
        .apiKey(System.getenv("TYPESAFE_API_KEY"))
        .model("jev-1.13.0")
        .maxRetries(2)          // 0..10, default 2
        .maxConcurrency(8)      // requests in flight, default 8
        .build();
```

The builder also sets `baseUrl`, `priority` (default 100), `connectTimeout` (default 5 s) and the availability TTLs `availableTtl` / `unavailableTtl`. An instance you build yourself is yours to close.

## How it is selected

When `isAvailable()` is true, `DecisionModelResolver.resolve()` selects it ahead of the `RuntimeDecisionModel` fallback over your `AgentRuntime`. The decision consumers then ask it their questions.

If it is unavailable when a resolution runs (no key yet, the endpoint down at boot, a probe timeout) and a real `AgentRuntime` is configured, the resolver returns the `RuntimeDecisionModel` fallback **provisionally**: one caller rescans every 30 s (`DecisionModelResolver.FALLBACK_RECHECK_INTERVAL`) and switches to TypeSafe once it answers. Until then the safety tiers ask the general LLM.

- The **scope and moderation tiers**, built without an explicit model (as `ScopeGuardrailResolver` and the Spring Boot starters' `LlmModerationDetector` build them), resolve on every check, so they pick up the switch.
- The **`LLM_CLASSIFIER` injection tier** builds its classifier once with the model it resolved and keeps it until `InjectionClassifierResolver.reset()`.
- With **no real `AgentRuntime`** (only the demo runtime) there is no fallback. An injection tier first resolved while TypeSafe is unavailable downgrades to `RULE_BASED` and **stays `RULE_BASED` until `InjectionClassifierResolver.reset()`**, even after the resolver starts returning TypeSafe. Its warning says so, and the console reports the tier the screens actually run.

## Availability probe

`isAvailable()` is `true` only after `GET /v1/models` returned `200` with the documented `{"models":[...]}` body. A key being set is not enough. With no key there is no probe and the answer is `false`.

- **Cached and shared.** The verdict is cached for 300 s when reachable and 30 s when not. It is shared by every instance with the same base URL, model and key (held as a SHA-256 digest, at most 64 configurations), and only one probe per configuration runs at a time. Each resolver scan builds a fresh instance through `ServiceLoader`, so without the shared verdict a rejected key or a dead endpoint would cost one probe per check; with it, one per 30 s.
- **Virtual-thread safe.** The probe holds a `ReentrantLock`, not a monitor, so a virtual thread waiting on it does not pin its carrier.
- **Rejection.** A `401` or `403` from a decision call marks the configuration unavailable at once.
- **Interrupts.** A probe whose caller is interrupted, or whose instance is closed mid-probe, records no verdict: that caller gets `false`, and the next caller probes again.

:::caution[The probe proves the key and the endpoint, not the model]
`GET /v1/models` lists the aliases, and TypeSafe documents that versioned IDs are accepted whether or not they are listed. The adapter therefore cannot require the configured model in that list without making the pinned default `jev-1.13.0` unavailable. A model id that passes the format check but does not exist (a typo, a retired version) reports `isAvailable()` `true`, is selected, and every question it is asked fails — which status the API returns for an unknown model has not been observed. The safety tiers read those failures as uncertain and fail closed by default. Check the model id when you set it: the resolver keeps the selected model until `DecisionModelResolver.reset()`.
:::

## Mapping

| Question | Sent as | Answer |
|----------|---------|--------|
| `Question.Noul(instructions, whenTrue, whenFalse)` | `{"type":"noul", ..., "criteria":{"true","false"}}`, sending only the criteria you set | `Answer.Noul(value = p >= 0.5, probabilityTrue = p, confidence = \|2p − 1\|)` |
| `Question.Choice(instructions, options)` | `{"type":"choice","criteria":{option: description or null}}` | `Answer.Choice(choice, probabilities, confidence)` as returned |
| `Question.Score(instructions, levels)` | `{"type":"score","criteria":[levels]}` | `Answer.Score(score, probabilities by level, confidence)` as returned |

All questions of one `DecisionRequest` travel in one HTTP exchange.

## Confidence source: `PROVIDER_DISTRIBUTION`

Every confidence the adapter returns has source `AiConfidence.Source.PROVIDER_DISTRIBUTION` — a source added for decision models that return a distribution. It appears on decision answers only, never on a streamed turn.

- **Noul.** The API returns only `p = P(yes)` and no confidence. The adapter derives `|2p − 1|`, the normalised margin of a two-value distribution — the same quantity `DecisionDistribution.marginOf` gives the value `p >= 0.5` selects.
- **Choice and score.** The number is TypeSafe's own `confidence`. TypeSafe does not document its exact formula; its docs illustrate it with the normalised margin.

TypeSafe describes its Jev models as trained to return calibrated decisions. Nothing in Atmosphere checks that claim against observed outcomes, which is why the source is named for where the number came from rather than for its quality.

Because the answers carry a real distribution, `NoulGate` reads the provider's `P(true)` in the scope and moderation tiers, and a flagged moderation category's score is that probability.

## Strict decoding

These cases are `UNPARSEABLE`:

- a field `api.md` marks required is missing or has the wrong JSON type. For the whole reply that is `model` (a non-blank string), `answers` and the `usage` object, and every question fails. For one answer it is `type` and that type's fields, and only that question fails;
- a `usage.input_tokens` or `usage.output_tokens` that is present but not a non-negative integer, or a pair whose sum overflows a `long`. A count that is missing or `null` is not an error: the answers are kept and the result reports no usage (an unknown count is never reported as zero);
- a `200` body that is not JSON;
- a body over 4 MiB, which is never buffered past the limit.

These are `INVALID_ANSWER`:

- an answer out of range: a choice that is not an option, a probability or noul outside `[0, 1]`, a score outside `[0, levels − 1]`;
- a distribution that does not name exactly the options or levels, or does not sum to 1 ± 0.02;
- a `choice` that is not the most likely option, or a `score` that differs from `Σ i·p(i)` by more than 0.05;
- an answer `type` that does not match the question, or a score `legend` that does not name exactly the levels `"0".."n-1"`.

A question missing from `answers` fails alone; the others keep their answers.

## Bounds, failures and retries

The question limits in `Question` match the API's: 2..255 options per choice and 2..10 levels per score. `DecisionRequest` adds 64 questions and 262,144 characters of state. The API's token budget is enforced only by the server, because the adapter cannot count Jev tokens; an over-budget request comes back as a `422`, which is `ERROR` and is not retried.

A failed exchange fails every question in it the same way, before `DecisionRequest.timeout()`:

| Outcome | Retried? | `Answer.Failed.Reason` |
|---------|----------|------------------------|
| 408, 429, 5xx (including 529), connection error (a dropped connection, a TCP connect timeout) | Yes, up to `maxRetries`. The wait is `retry-after-ms`, else `Retry-After` (seconds or an HTTP date), else 500 ms doubling to 5 s with up to 25% jitter. A wait that would reach the deadline is not taken | final 429/529: `CAPACITY`; others: `ERROR` |
| 401, 403 | No (also marks the model unavailable) | `ERROR` |
| 422 and other 4xx | No | `ERROR` |
| Deadline passed (the in-flight request is cancelled), including while TCP is still connecting | No | `TIMEOUT` |
| `close()` while the request is in flight | No | `ERROR` |
| All `maxConcurrency` slots busy until the deadline | No | `CAPACITY` |

Each failure detail names the HTTP status, the provider's message and its `x-typesafe-request-id`. The API key is never logged.

## As an injection backend: the rule-based floor

`InjectionClassifierResolver` builds the `LLM_CLASSIFIER` injection tier as `CompositeInjectionClassifier(RuleBasedInjectionClassifier, LlmClassifierInjectionClassifier(model))`, so the rule-based floor runs first. A canonical injection ("ignore all previous instructions…") is dropped without the provider being asked, even if the provider would have cleared it. The provider is asked only about documents the rules pass, so it can never clear what the rules flag. `TypesafeDiscoveryTest#asTheInjectionBackendItStaysBehindTheRuleBasedFloor` pins this against a stub that clears everything.

## Lifecycle

`TypesafeDecisionModel` creates its `HttpClient` on its first request, owns it and closes it in `close()`. An instance that only reads a cached verdict never creates one. `close()` is idempotent: it aborts the exchanges in flight instead of waiting for them, then waits at most 5 s for the client to terminate. A question in flight at that moment fails with `ERROR`, and a closed model is unavailable.

The instance `DecisionModelResolver` selects is closed by `DecisionModelResolver.reset()` (which `InjectionClassifierResolver.reset()` calls). Nothing else closes it — no framework shutdown hook does — so it lives until a reset or the end of the JVM.

## Tests

| Test | Needs | What it pins |
|------|-------|--------------|
| `TypesafeDecisionModelContractTest` | nothing (a JDK `HttpServer` stub on loopback) | the documented request bodies, every answer type, 401/403/422/429/529/503, retries, retry-after, the deadline, the body and concurrency bounds, availability caching and sharing, `close()` aborting a request in flight |
| `TypesafeWireTest` | nothing | strict decoding, criteria encoding, retry header parsing |
| `TypesafeDiscoveryTest` | nothing | ServiceLoader registration, system-property configuration, resolver selection, the rule-based floor |
| `TypesafeLiveTest` | `TYPESAFE_API_KEY`, or `-Dtypesafe.live=true` for the invalid-key test only | the real API |

## See Also

- [Decision Models](/docs/reference/decision-models/) — the SPI, the resolver and its consumers
- [AI / LLM reference](/docs/reference/ai/#confidence-routing) — confidence routing and intent routing
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/ai-decision-typesafe)
- [TypeSafe documentation](https://docs.typesafe.ai)
