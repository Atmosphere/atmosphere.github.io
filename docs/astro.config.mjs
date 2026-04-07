import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://async-io.org',
  base: '/docs',
  integrations: [
    starlight({
      title: 'Atmosphere',
      description: 'Real-time for the JVM — WebSocket, SSE, gRPC, rooms, presence, AI streaming, and multi-agent orchestration',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/Atmosphere/atmosphere' },
      ],
      editLink: {
        baseUrl: 'https://github.com/Atmosphere/atmosphere.github.io/edit/main/docs/',
      },
      customCss: ['./src/styles/custom.css'],
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: '/docs/favicon.svg', type: 'image/svg+xml' } },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Welcome', slug: 'welcome' },
            { label: 'Architecture', slug: 'architecture' },
            { label: 'CLI', slug: 'tutorial/00-cli' },
            { label: 'First App', slug: 'tutorial/02-getting-started' },
            { label: "What's New in 4.0", slug: 'whats-new' },
          ],
        },
        {
          label: 'Tutorial',
          items: [
            {
              label: 'Agents',
              collapsed: false,
              items: [
                { label: 'Introduction', slug: 'tutorial/01-introduction' },
                { label: '@Agent & @Prompt', slug: 'agents/agent' },
                { label: '@AiTool & Human-in-the-Loop', slug: 'tutorial/10-ai-tools' },
                { label: '@Command & Skill Files', slug: 'agents/skills' },
                { label: '@Coordinator & Multi-Agent', slug: 'agents/coordinator' },
                { label: 'AI Adapters', slug: 'tutorial/11-ai-adapters' },
                { label: 'AI Filters & Routing', slug: 'tutorial/12-ai-filters' },
                { label: 'Channels', slug: 'tutorial/23-channels' },
              ],
            },
            {
              label: 'Protocols',
              collapsed: false,
              items: [
                { label: 'MCP Server', slug: 'tutorial/13-mcp' },
                { label: 'A2A Protocol', slug: 'agents/a2a' },
                { label: 'AG-UI Protocol', slug: 'agents/agui' },
              ],
            },
            {
              label: 'Real-Time Infrastructure',
              collapsed: true,
              items: [
                { label: '@AiEndpoint & Streaming', slug: 'tutorial/09-ai-endpoint' },
                { label: '@ManagedService', slug: 'tutorial/03-managed-service' },
                { label: 'Transports', slug: 'tutorial/04-transports' },
                { label: 'Broadcaster & Pub/Sub', slug: 'tutorial/05-broadcaster' },
                { label: 'Rooms & Presence', slug: 'tutorial/06-rooms' },
                { label: 'WebSocket Deep Dive', slug: 'tutorial/07-websocket' },
                { label: 'Interceptors', slug: 'tutorial/08-interceptors' },
                { label: 'gRPC & Kotlin', slug: 'tutorial/20-grpc-kotlin' },
              ],
            },
            {
              label: 'Deployment',
              collapsed: true,
              items: [
                { label: 'Spring Boot', slug: 'tutorial/14-spring-boot' },
                { label: 'Quarkus', slug: 'tutorial/15-quarkus' },
                { label: 'WAR Deployment', slug: 'tutorial/21-war-deployment' },
                { label: 'Clustering', slug: 'tutorial/16-clustering' },
                { label: 'Durable Sessions', slug: 'tutorial/17-durable-sessions' },
                { label: 'Observability', slug: 'tutorial/18-observability' },
                { label: 'Migration 2.x → 4.0', slug: 'tutorial/22-migration' },
              ],
            },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'AI / LLM', slug: 'reference/ai' },
            { label: 'AI Testing', slug: 'reference/testing' },
            { label: 'Core Runtime', slug: 'reference/core' },
            { label: 'Rooms & Presence', slug: 'reference/rooms' },
            { label: 'MCP Server', slug: 'reference/mcp' },
            { label: 'WebTransport/HTTP3', slug: 'reference/webtransport' },
            { label: 'gRPC Transport', slug: 'reference/grpc' },
            { label: 'Kotlin DSL', slug: 'reference/kotlin' },
            { label: 'Observability', slug: 'reference/observability' },
            { label: 'Admin Control Plane', slug: 'reference/admin' },
            { label: 'Durable Sessions', slug: 'reference/durable-sessions' },
            { label: 'Durable Checkpoints', slug: 'reference/checkpoint' },
            { label: 'Performance Benchmarks', slug: 'reference/benchmarks' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'Spring Boot', slug: 'integrations/spring-boot' },
            { label: 'Quarkus', slug: 'integrations/quarkus' },
            { label: 'Spring AI', slug: 'integrations/spring-ai' },
            { label: 'LangChain4j', slug: 'integrations/langchain4j' },
            { label: 'Google ADK', slug: 'integrations/adk' },
            { label: 'Embabel', slug: 'integrations/embabel' },
          ],
        },
        {
          label: 'Infrastructure',
          items: [
            { label: 'Redis Clustering', slug: 'infrastructure/redis' },
            { label: 'Kafka Clustering', slug: 'infrastructure/kafka' },
          ],
        },
        {
          label: 'Client Libraries',
          items: [
            { label: 'atmosphere.js', slug: 'clients/javascript' },
            { label: 'wAsync (Java)', slug: 'clients/java' },
            { label: 'React Native', slug: 'clients/react-native' },
          ],
        },
      ],
    }),
  ],
});
