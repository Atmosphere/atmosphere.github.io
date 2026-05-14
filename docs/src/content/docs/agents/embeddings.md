---
title: "Embeddings"
description: "EmbeddingRuntime SPI — runtime-agnostic text embedding across Spring AI, LangChain4j, Semantic Kernel, Embabel, and the Built-in client"
---

# Embeddings

`EmbeddingRuntime` is the sibling SPI to `AgentRuntime` for text-embedding
generation. Each supported LLM framework ships an implementation discovered
through `ServiceLoader`, so your RAG pipeline can swap embedding backends by
changing one dependency — exactly the same contract as `@AiEndpoint` and
`@AiTool` across chat runtimes.

## Why a separate SPI

Prior to 4.0.36 the `modules/rag` package consumed provider-specific embedding
APIs directly (Spring AI `EmbeddingModel`, LangChain4j `EmbeddingModel`, etc.),
which meant RAG code locked you into one backend. `EmbeddingRuntime` lifts
that into a runtime-agnostic SPI with a uniform API:

- `float[] embed(String text)` — embed a single text into a vector
- `List<float[]> embedAll(List<String> texts)` — batch variant (preferred for
  amortizing per-request overhead)
- `int dimensions()` — the vector length, or `-1` if the runtime cannot
  answer without a network call
- `boolean isAvailable()` — whether this runtime's native API is on the
  classpath AND a concrete embedding model has been wired
- `String name()` — human-readable ID: `"spring-ai"`, `"langchain4j"`,
  `"semantic-kernel"`, `"embabel"`, `"built-in"`
- `int priority()` — selection priority when multiple runtimes are present
  (higher wins)

## Runtime priorities

The default resolver picks the highest-priority runtime whose
`isAvailable()` returns `true`. Priorities are stable across releases so
adapter wrappers always win over the zero-dependency fallback:

| Runtime | Priority | Status |
|---------|---------:|--------|
| Spring AI (`spring-ai`) | **200** | Available when a Spring-managed `EmbeddingModel` bean is wired |
| LangChain4j (`langchain4j`) | **190** | Available when a `dev.langchain4j.model.embedding.EmbeddingModel` instance is injected |
| Semantic Kernel (`semantic-kernel`) | **180** | Available when a `TextEmbeddingGenerationService` is supplied. Uses `Mono.block()` at the sync boundary and unwraps `List<Float>` → `float[]` |
| Embabel (`embabel`) | **170** | Thin pass-through over `com.embabel.common.ai.model.EmbeddingService` |
| Built-in (`built-in`) | **50** | Zero-dependency OpenAI-compatible `/v1/embeddings` client. Fallback used when no framework-native `EmbeddingModel` is wired. |

The Built-in runtime sits below every adapter so a framework-native
`EmbeddingModel` always wins when present. Direct `OpenAiCompatibleClient`
callers bypass the resolver and use the Built-in implementation unconditionally.

## Auto-discovery

Add the corresponding `atmosphere-*` dependency to your project:

```xml
<!-- Spring AI embedding runtime (priority 200) -->
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-spring-ai</artifactId>
    <version>${project.version}</version>
</dependency>

<!-- or LangChain4j (priority 190) -->
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-langchain4j</artifactId>
    <version>${project.version}</version>
</dependency>

<!-- or Semantic Kernel (priority 180) -->
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-semantic-kernel</artifactId>
    <version>${project.version}</version>
</dependency>
```

On application startup Atmosphere scans the classpath via
`ServiceLoader<EmbeddingRuntime>` and picks the highest-priority
`isAvailable()` runtime. No code changes needed when swapping backends.

## Programmatic usage

```java
import org.atmosphere.ai.EmbeddingRuntime;
import org.atmosphere.ai.EmbeddingRuntimeResolver;

// Resolve the active runtime (highest-priority available)
EmbeddingRuntime runtime = EmbeddingRuntimeResolver.resolve()
        .orElseThrow(() -> new IllegalStateException(
                "No EmbeddingRuntime available — add atmosphere-spring-ai or " +
                "atmosphere-langchain4j to the classpath, or configure AiConfig " +
                "for the Built-in fallback"));

// Single embedding
float[] vector = runtime.embed("Atmosphere is the unified AI runtime abstraction on the JVM.");
System.out.println("Dimensions: " + vector.length);

// Batch embedding (preferred for multiple inputs)
List<float[]> vectors = runtime.embedAll(List.of(
        "First document",
        "Second document",
        "Third document"));
```

`EmbeddingRuntimeResolver.resolveAll()` returns all available runtimes in
priority order if you need to fan out or pick a specific backend manually.

## Wiring a framework-native embedding model

The embedding-capable runtimes are Built-in, Spring AI, LangChain4j,
Semantic Kernel, and Embabel. The adapter runtimes wrap a framework-managed
`EmbeddingModel` / `EmbeddingService` / `TextEmbeddingGenerationService`
instance. Wire it via the adapter's static setter during startup:

### Spring AI

```java
@Configuration
public class EmbeddingConfig {
    @Bean
    EmbeddingModel openAiEmbeddingModel() {
        return new OpenAiEmbeddingModel(...);
    }

    @PostConstruct
    void registerWithAtmosphere(@Autowired EmbeddingModel model) {
        SpringAiEmbeddingRuntime.setEmbeddingModel(model);
    }
}
```

### LangChain4j

```java
var lc4jEmbedder = OpenAiEmbeddingModel.builder()
        .apiKey(System.getenv("OPENAI_API_KEY"))
        .build();
LangChain4jEmbeddingRuntime.setEmbeddingModel(lc4jEmbedder);
```

### Semantic Kernel

```java
var skService = OpenAITextEmbeddingGenerationService.builder()
        .withApiKey(System.getenv("OPENAI_API_KEY"))
        .withModelId("text-embedding-3-small")
        .build();
SemanticKernelEmbeddingRuntime.setEmbeddingService(skService);
```

### Embabel

```java
EmbabelEmbeddingRuntime.setEmbeddingService(embabelEmbeddingService);
```

### Built-in (zero-dep fallback)

No wiring needed — the Built-in runtime reads `AiConfig.baseUrl` + `apiKey`
at call time and POSTs to `/v1/embeddings` on any OpenAI-compatible endpoint
(OpenAI, Azure OpenAI, Gemini's OpenAI gateway, Ollama, LocalAI, etc.).

```java
// Override the default model name if needed
var builtIn = new BuiltInEmbeddingRuntime();
builtIn.setEmbeddingModel("text-embedding-3-large");
```

## Contract tests — `AbstractEmbeddingRuntimeContractTest`

Every concrete `EmbeddingRuntime` ships with a contract-test subclass of
`AbstractEmbeddingRuntimeContractTest`. The base assertions exercise
`embed()`, `embedAll()`, `dimensions()`, and `isAvailable()` with a
deterministic fake embedder so the bridge plumbing is validated without
live network calls.

The seven parity assertions are:

1. `runtimeHasStableName()` — `name()` returns a non-blank, stable identifier
2. `embedSingleTextReturnsVectorOfExpectedDimension()` — single-text round-trip
3. `embedAllReturnsVectorPerInputInOrder()` — batch round-trip preserves order
4. `embedAllWithEmptyListReturnsEmptyList()` — edge case
5. `runtimeIsAvailableAfterFakeInjection()` — availability gate flips on injection
6. `dimensionsAccessorIsNonNegativeOrMinusOne()` — dimension advertising contract
7. `runtimeDeclaresStablePriority()` — `priority()` returns a stable integer

If you add a new `EmbeddingRuntime` implementation, subclass the base and
supply a deterministic fake embedder via `installFakeEmbedder()` — no
need to write the same assertions again.

## Capabilities matrix

| Runtime | `embed()` | `embedAll()` batched | `dimensions()` | Notes |
|---------|:---------:|:--------------------:|:--------------:|-------|
| Spring AI      | ✅ | ✅ native batch | ✅ | `model.dimensions()` |
| LangChain4j    | ✅ | ✅ native batch via `TextSegment` | ✅ | `model.dimension()` |
| Semantic Kernel| ✅ | ✅ native batch | `-1` | `Mono.block()` sync boundary |
| Embabel        | ✅ | ✅ native batch | ✅ | 1:1 pass-through |
| Built-in       | ✅ | ✅ via `/v1/embeddings` | ✅ from config | OpenAI-compatible wire format |

## See also

- [AI / LLM Reference](../../reference/ai/) — `AgentRuntime` SPI and capability matrix
- [RAG Module](../../reference/ai/#rag) — how RAG pipelines consume `EmbeddingRuntime`
- [Spring AI Integration](../../integrations/spring-ai/)
- [LangChain4j Integration](../../integrations/langchain4j/)
