---
title: "Decision Models"
description: "DecisionModel SPI — typed choice, score and yes/no answers with a confidence, RuntimeDecisionModel over any AgentRuntime, DecisionModelResolver discovery, and the safety tiers and intent routing that consume it"
---

# Decision Models

`DecisionModel` (package `org.atmosphere.ai.decision`, module `atmosphere-ai`) is a small SPI, separate from `AgentRuntime`, for models that **decide** rather than write. Given some state and up to 64 questions, it returns one typed answer per question. Nothing streams. Each question is evaluated in isolation — no question sees another's text — and the questions run in parallel.

:::note[Not in a release yet]
The `org.atmosphere.ai.decision` package was added after 4.0.71 and ships in the next release. It is on `main` (4.0.72-SNAPSHOT).
:::

```java
public interface DecisionModel {
    String name();
    boolean isAvailable();          // runtime truth, never classpath presence
    default int priority() { return 0; }
    DecisionResult decide(DecisionRequest request);
}
```

## Asking questions

```java
var questions = new LinkedHashMap<String, Question>();
questions.put("intent", new Question.Choice("What does the user want?",
        new LinkedHashMap<>(Map.of("refund", "money back", "track", "where is my parcel"))));
questions.put("urgency", new Question.Score("How urgent is it?", List.of("low", "normal", "high")));
questions.put("abusive", new Question.Noul("Is the message abusive?", null, null));

var model = DecisionModelResolver.resolve().orElseThrow();
var result = model.decide(new DecisionRequest(message, questions, Duration.ofSeconds(5)));
if (result.route("intent", ConfidenceRouting.of(0.9, 0.5)) == ConfidenceRoute.ACT) {
    var intent = result.answer("intent", Answer.Choice.class).orElseThrow().choice();
}
```

`Question` and `Answer` are sealed interfaces:

| Question | Answer | Bounds |
|----------|--------|--------|
| `Question.Choice(instructions, options)` — pick one option | `Answer.Choice(id, choice, probabilities, confidence)` | 2..255 options |
| `Question.Score(instructions, levels)` — place on an ordered rubric | `Answer.Score(id, score, probabilities, confidence)`; `score = Σ i·p(i)` when measured, else the chosen level | 2..10 levels |
| `Question.Noul(instructions, whenTrue, whenFalse)` — decide a boolean | `Answer.Noul(id, value, probabilityTrue, confidence)` | optional true/false criteria |

A question that cannot be answered is an `Answer.Failed(id, reason, detail)` with a reason — `TIMEOUT`, `CAPACITY`, `ERROR`, `UNPARSEABLE` or `INVALID_ANSWER` — never a missing entry and never a guess.

Every answer's `confidence()` is the same `AiConfidence` a streamed turn carries, so a [`ConfidenceRouting`](/docs/reference/ai/#confidence-routing) gates it unchanged: `DecisionResult.route(id, routing)` returns `ACT`, `CONFIRM` or `ESCALATE`. A missing or failed answer, or one with unknown confidence, takes the routing's unknown route (`ESCALATE` by default) — an answer nobody measured never acts.

**Request bounds.** `DecisionRequest` holds at most 64 questions (ids match `[A-Za-z0-9_-]{1,64}`), at most 262,144 characters of state (`String.length()`, not bytes), and a timeout (default 5 s, `DecisionRequest.DEFAULT_TIMEOUT`) that covers the whole request. `DecisionRequest.of(state, id, question)` builds a single-question request.

## Discovery — `DecisionModelResolver`

`DecisionModelResolver.resolve()` returns, in order:

1. the available `META-INF/services/org.atmosphere.ai.decision.DecisionModel` registration with the highest `priority()`;
2. otherwise a `RuntimeDecisionModel` over the resolved `AgentRuntime`, but only if that runtime is not the demo fallback. A keyless local model (Ollama, `LLM_MODE=local`) counts as reachable;
3. otherwise empty: no model can answer.

Only a non-empty result is cached, so a model configured after the first lookup is still picked up. `DecisionModelResolver.reset()` forgets the cached model and closes it when it is `AutoCloseable`; a consumer that already holds it, such as a built `LLM_CLASSIFIER` injection screen, keeps the closed instance until it is rebuilt.

The fallback `RuntimeDecisionModel` is **one instance shared** by every consumer that resolves through here — the injection, scope and moderation tiers and an intent routing without a model of its own — so its concurrency bound is shared too. It allows 8 questions in flight unless the JVM system property `-Dorg.atmosphere.ai.decision.max-concurrency=<n>` sets another positive integer. The property is read when the fallback is first resolved; it is not an `application.properties` key. A registered `DecisionModel` sizes itself.

## `RuntimeDecisionModel` — any `AgentRuntime` as a decision model

The reference implementation asks each question as one structured-output call over any `AgentRuntime`. The call has no history, tools, memory or context providers, and the reply must be `{"answer": <value>, "confidence": <0..1>}`. The `answer` value set is closed:

- a boolean for `Noul`;
- the codes `"A".."P"` for a `Choice` of at most 16 options (mapped back to the option keys), and the option keys themselves above 16;
- `"0".."n-1"` for a `Score`.

The schema is always in the system prompt. It is also enforced natively when the runtime advertises `NATIVE_STRUCTURED_OUTPUT`, with one prompt-only retry if the provider rejects the schema. A reply that is not JSON is `UNPARSEABLE`; a value outside the set is `INVALID_ANSWER`. There is no lenient yes/no reading of free text.

- **Concurrency.** At most 8 questions per instance are in flight by default (`new RuntimeDecisionModel(runtime, maxConcurrency, minObservedMass)` sets another bound); the rest wait for a slot and are `CAPACITY` only if none frees before the deadline.
- **Deadline.** At the deadline an unfinished question is cancelled through its `ExecutionHandle` and its carrier thread is interrupted. `decide()` never waits on a carrier, so a runtime that ignores both still cannot hold it past the deadline.
- **Reply bound.** Each reply is bounded at 16,384 characters; a runtime that streams past it is settled as `UNPARSEABLE`, then cancelled.
- **Ownership.** The runtime is borrowed, never closed.

### Where the confidence comes from

| Mode | When | What the answer carries |
|------|------|-------------------------|
| **Distribution-derived** (`DECISION_LOGPROBS`) | The Built-in runtime on its chat-completions path, where the endpoint passes the logprobs gate, for value sets of 16 or fewer. `answer` is the [decision field](/docs/reference/ai/#decision-level-confidence-decision_logprobs); the distribution must cover exactly the allowed values with an `observedMass` of at least 0.5 | The probabilities (`Choice` / `Score` maps, `Noul.probabilityTrue`) and, as the aggregate, the margin of the value the reply actually carries (`DecisionDistribution.marginOf`) — `0` unless that value is strictly the most likely, so a value sampled against the distribution routes to `ESCALATE` |
| **Model-reported** (`MODEL_REPORTED_FIELD`) | Every other runtime, a `Choice` above 16 options, an endpoint without `top_logprobs`, a distribution below the mass floor | The reply's `confidence` as the aggregate. The probability maps and `probabilityTrue` stay **empty** — they are never inferred from the self-reported number. A missing or out-of-range value is unknown |

These probabilities are the model's own token probabilities over the allowed values. They are distribution-derived, not calibrated: nothing in Atmosphere checks them against observed outcomes.

## External decision models

A `DecisionModel` registered through `META-INF/services` is selected ahead of the `RuntimeDecisionModel` fallback while it reports `isAvailable()`. The [TypeSafe adapter](/docs/integrations/typesafe/) (`atmosphere-ai-decision-typesafe`, not in a release yet) is one: a model over the TypeSafe System One API whose answers carry the provider's distribution and the confidence source `PROVIDER_DISTRIBUTION`. Its page covers how the resolver treats a registration that is not answering yet.

## Consumers

### The three LLM safety tiers

Three safety tiers ask `Noul` questions through `DecisionModelResolver` (or a `RuntimeDecisionModel` over the runtime they were given):

| Tier | How you select it | Question |
|------|-------------------|----------|
| `LLM_CLASSIFIER` **injection** tier — RAG read path (`SafetyContextProvider`) and long-term-memory write path (`ScreenedLongTermMemory`) | `atmosphere.ai.rag.safety.tier=LLM_CLASSIFIER` / `atmosphere.ai.memory.safety.tier=LLM_CLASSIFIER` (Quarkus: `quarkus.atmosphere.ai.rag.safety.*` / `quarkus.atmosphere.ai.memory.safety.*`) | one per document: is it an injection? |
| `LLM_CLASSIFIER` **scope** tier — `LlmClassifierScopeGuardrail` | `@AgentScope(tier = LLM_CLASSIFIER)`, a skill file's `scopeTier: llm` frontmatter, or a per-request `ScopeConfig` | one per request: is it off-topic for the declared purpose, or does it touch a forbidden topic? |
| **Moderation** — `LlmModerationDetector` behind `ModerationGuardrail` | `atmosphere.ai.guardrails.moderation.enabled=true` + `atmosphere.ai.guardrails.moderation.detector=llm` (Spring Boot), or `new ModerationGuardrail(new LlmModerationDetector())` | one per `ModerationCategory` the guardrail blocks, all in one request |

The injection tier runs **on top of the `RULE_BASED` floor**: the zero-dependency probes run first, so a model can only add recall there, never clear what the rules flag.

All three read the answer the same way — the injection tier with its own mapping, the scope and moderation tiers through `NoulGate`, whose default thresholds match the injection tier's:

- a belief in `true` of at least **0.5** flags, and so does a `true` answer that carries no confidence at all;
- a `false` answer with a belief below **0.2** clears;
- everything else is **uncertain** — the band between, a `false` answer with no confidence, a `true` answer the belief disagrees with, any `Answer.Failed` (timeout, capacity, runtime error, empty, unparseable or out-of-set reply) and state over 262,144 characters.

A model-reported confidence `c` reads as `P(true) = c` for a `true` answer and `1 - c` for a `false` one, so the thresholds give the same verdict whether the belief was measured or self-reported.

For the scope and moderation tiers, no decision model at all (only the demo runtime) is uncertain too; the injection tier instead downgrades to `RULE_BASED` with a warning, and the console reports `RULE_BASED`. The RAG and memory screens keep that classifier until they are rebuilt (in practice, a restart); `InjectionClassifierResolver.reset()` alone does not change a screen already built.

**Uncertain fails closed by default** in each tier:

| Tier | Uncertain verdict | Explicit opt-out |
|------|-------------------|------------------|
| Injection | document dropped | `atmosphere.ai.rag.safety.fail-open=true` / `atmosphere.ai.memory.safety.fail-open=true` |
| Scope | `ScopePolicy` denies the request at pre-admission | JVM system property `org.atmosphere.ai.scope.llm-classifier.fail-open=true` (`-D` or `System.setProperty`, read on each uncertain verdict; not an `application.properties` key), or the `failOpen` argument of `new LlmClassifierScopeGuardrail(model, timeout, gate, failOpen)` |
| Moderation | `ModerationGuardrail` blocks the turn | `ModerationGuardrail.failOpen()` / `atmosphere.ai.guardrails.moderation.fail-open=true` |

Even with moderation's `failOpen()`, a category the detector did flag still blocks. The scope tier's post-response check (`@AgentScope(postResponseCheck = true)`) keeps its posture: the bytes are already on the wire, so an uncertain verdict there admits and a flagged one denies.

:::caution[Behaviour change]
Before this, all three tiers read free text and admitted an empty, unparseable (for the injection tier, ambiguous) or timed-out reply. A RAG or long-term-memory screen on `LLM_CLASSIFIER` now **drops** a document whose classifier reply is blank, ambiguous or timed out, unless `atmosphere.ai.rag.safety.fail-open` / `atmosphere.ai.memory.safety.fail-open` is set. An `@AgentScope(tier = LLM_CLASSIFIER)` endpoint with no reachable model now **denies every request** unless the opt-out is set.
:::

**Capacity.** With every category blocked, one moderation inspection asks six questions (fewer after `.blocking(...)`), in parallel under one 5 s deadline. By default those share the fallback's 8 slots with the injection and scope tiers and intent routing; concurrent turns past that bound wait, and a question with no slot by the deadline is `CAPACITY` — uncertain, so the turn is blocked. Size the pool with `-Dorg.atmosphere.ai.decision.max-concurrency=<n>`, register a `DecisionModel` with its own bound, or build the consumer over its own `RuntimeDecisionModel`.

### Intent routing

`IntentRouting` asks one `Question.Choice` per admitted request over the declared routes and gates the answer with `ConfidenceRouting` tiers, before the request reaches the LLM. See [Intent routing](/docs/reference/ai/#intent-routing). Without `withDecisionModel(...)` it resolves through `DecisionModelResolver`, so it shares the fallback's slots with the safety tiers; for a high-traffic endpoint, give it its own `RuntimeDecisionModel`.

`Choice` has that one production consumer. `Score` remains API plus reference implementation, with no production consumer in the framework.

## See Also

- [AI / LLM reference](/docs/reference/ai/) — confidence routing, decision-level confidence, intent routing
- [TypeSafe adapter](/docs/integrations/typesafe/) — an external `DecisionModel`
- [@AgentScope tutorial](/docs/tutorial/31-agent-scope/) — the scope tiers
- [Governance Policy Plane](/docs/reference/governance/)
- [Module README](https://github.com/Atmosphere/atmosphere/tree/main/modules/ai#decision-models-typed-choice--score--boolean)
