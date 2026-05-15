---
title: RAG (`atmosphere-rag`)
description: Retrieval-Augmented Generation surface — ContextProvider SPI, six built-in providers, RagChunker, and a reachability matrix that extends to every vector store Spring AI or LangChain4j supports.
---

The `atmosphere-rag` module ships the `ContextProvider` SPI and six
built-in implementations: an in-memory provider for tests, two SPI
bridges (Spring AI `VectorStore`, LangChain4j `EmbeddingStore`), and
three direct connectors (pgvector, Qdrant, Pinecone) that talk to the
backend over its native protocol with zero Spring AI / LangChain4j
dependency.

```xml
<dependency>
    <groupId>org.atmosphere</groupId>
    <artifactId>atmosphere-rag</artifactId>
    <version>${atmosphere.version}</version>
</dependency>
```

## Built-in providers

| Implementation | Backend | Extra dependency |
|----------------|---------|------------------|
| `InMemoryContextProvider` | Word-overlap scoring | None |
| `SpringAiVectorStoreContextProvider` | Spring AI `VectorStore` (Pinecone, pgvector, Weaviate, Milvus, Chroma, …) | `spring-ai-vector-store` |
| `LangChain4jEmbeddingStoreContextProvider` | LangChain4j `EmbeddingStore` (Chroma, Elasticsearch, Pinecone, Weaviate, …) | `langchain4j-core` |
| `PgVectorContextProvider` | Postgres + `pgvector` via JDBC | None (uses a `DataSource` + `EmbeddingRuntime`) |
| `QdrantContextProvider` | Qdrant REST API | None (uses `java.net.http.HttpClient`) |
| `PineconeContextProvider` | Pinecone REST API | None (uses `java.net.http.HttpClient`) |

## Vector-store reachability matrix

The Spring AI and LangChain4j bridges multiply: every backend either of
those ecosystems supports is reachable through Atmosphere with one
config bean. The matrix below shows the practical reachability today —
the three direct connectors give zero-dep paths for the three most-asked
stores; the bridges cover the long tail without adding a second
framework to the classpath.

| Vector store | Direct connector | Spring AI bridge | LangChain4j bridge |
|--------------|:---------------:|:----------------:|:------------------:|
| Postgres / pgvector | ✅ | ✅ | ✅ |
| Qdrant | ✅ | ✅ | ✅ |
| Pinecone | ✅ | ✅ | ✅ |
| Weaviate | — | ✅ | ✅ |
| Milvus | — | ✅ | ✅ |
| Chroma | — | ✅ | ✅ |
| Elasticsearch | — | ✅ | ✅ |
| Redis Stack | — | ✅ | ✅ |
| MongoDB Atlas Vector Search | — | ✅ | — |
| OpenSearch | — | ✅ | ✅ |
| Cassandra | — | ✅ | ✅ |

## `ContextProvider` SPI

```java
public interface ContextProvider {
    List<Document> retrieve(String query, int maxResults);

    default String transformQuery(String originalQuery) { return originalQuery; }
    default List<Document> filter(String query, List<Document> documents) { return documents; }
    default List<Document> rerank(String query, List<Document> documents) { return documents; }
    default List<Document> postProcess(String query, List<Document> documents) { return documents; }

    static String formatCitation(Document document) { ... }
    default boolean isAvailable() { return true; }
}
```

Execution order during `AiStreamingSession.stream()`:

```
transformQuery() → normalize/blank-query guard → retrieve() →
  filter() → rerank() → postProcess() → formatCitation() →
  inject into AiRequest.message
```

`formatCitation()` includes source and chunk metadata when present:
`source_document`, `chunk_index`, `chunk_count`, `chunk_start`,
`chunk_end`. The Spring Boot RAG Chat sample preserves chunk metadata
when it ingests its Markdown knowledge base, so citations point to a
source passage rather than just naming the file.

## `RagChunker` — ingestion helper

Vector stores retrieve chunks, not books. `RagChunker` splits large
documents into bounded, overlapping chunks before they enter the index:

```java
var sourceDocs = List.of(
    new ContextProvider.Document(markdown, "docs/operations.md", 1.0));

// 1,200 chars per chunk, 150-char overlap (defaults)
var chunks = RagChunker.chunkAll(sourceDocs);
vectorStore.add(chunks.stream()
    .map(d -> new Document(d.content(), Map.of(
        "source", d.source(),
        "source_document", d.metadata().get("source_document"),
        "chunk_index", d.metadata().get("chunk_index"))))
    .toList());
```

Chunk metadata preserves the original source document, chunk index,
total chunk count, and character offsets for citation attribution.

## Direct connectors

The three direct connectors all share the same shape: embed the user
query through an injected `EmbeddingRuntime`, then talk to the backend
over its native protocol. None of them depend on Spring AI or
LangChain4j, so they are the right choice for lean apps that want a
single vector store and no framework coupling.

### `PgVectorContextProvider`

```java
var provider = PgVectorContextProvider.builder(dataSource, embeddingRuntime)
    .table("documents")
    .embeddingColumn("embedding")
    .contentColumn("content")
    .sourceColumn("source")
    .distanceOperator("<=>")        // cosine (default); <->  L2; <#> inner product
    .queryTimeoutSeconds(30)
    .build();

var hits = provider.retrieve("How do I reconnect?", 4);
```

Issues a single prepared statement using pgvector's `<=>` operator and
maps results into `Document(content, source, score = 1 - distance)`.
Table and column identifiers are validated against
`[A-Za-z_][A-Za-z0-9_]*` at construction time per Boundary-Safety
invariant.

### `QdrantContextProvider`

```java
var provider = QdrantContextProvider.builder(
        "https://qdrant.example.com:6333", "atmosphere-docs", embeddingRuntime)
    .apiKey(System.getenv("QDRANT_API_KEY"))
    .contentField("content")
    .sourceField("source")
    .build();
```

Single HTTP `POST` to
`/collections/{collection}/points/search`. The collection name is
validated and URL-encoded before splicing into the URI.

### `PineconeContextProvider`

```java
var provider = PineconeContextProvider.builder(
        "atm-docs-abc.svc.us-east-1.pinecone.io",
        System.getenv("PINECONE_API_KEY"),
        embeddingRuntime)
    .namespace("docs")
    .apiVersion("2024-10")          // default
    .contentField("content")
    .sourceField("source")
    .build();
```

Single HTTP `POST` to `https://{indexHost}/query` with `Api-Key` and
`X-Pinecone-API-Version` headers. The index host is validated to reject
scheme, path, port, or query characters.

## Quick start

`InMemoryContextProvider` is the zero-dep path for development and
testing:

```java
var provider = InMemoryContextProvider.fromClasspath(
        "docs/websocket.md", "docs/sse.md", "docs/grpc.md");

// Or chunk larger resources before retrieval
var chunked = InMemoryContextProvider.fromClasspathChunked(
        1_200, 150, "docs/manual.md", "docs/architecture.md");

List<ContextProvider.Document> hits =
    provider.retrieve("How does WebSocket work?", 3);
```

The `rag` flagship template (`atmosphere new <name> --template rag`)
scaffolds a Spring Boot project that wires `InMemoryContextProvider`
plus the chunker, and is the canonical "start from here" path.
