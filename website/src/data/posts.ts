// Shared by the blog index (pages/blog/index.astro) and the RSS feed (pages/rss.xml.ts).
// Post index. Dates are the real first-commit dates of each post file; excerpts
// are drawn from the post's own lede. Newest first. When a post is added under
// pages/blog/, add its entry here.
export const posts = [
  {
    slug: 'atmosphere-4x-ai',
    title: 'Atmosphere 4 released, now shipping a portable AI agent component',
    date: '2026-08-19',
    dateLabel: 'August 19, 2026',
    excerpt:
      `I added an AI agent layer to Atmosphere. Wiring up the LLM was the easy
       part — the streaming was already done. One @Agent class, twelve
       interchangeable runtimes behind one SPI, and durable workflows that now
       run on Temporal by swapping a dependency.`,
    tag: 'Engineering',
  },
  {
    slug: 'workflow-on-temporal',
    title: 'Run Atmosphere workflows on Temporal, by swapping one dependency',
    date: '2026-07-16',
    dateLabel: 'July 16, 2026',
    excerpt:
      `The durable-execution engine behind Workflow.run() is now a ServiceLoader
       seam. The first external engine to plug into it: Temporal. The workflow
       code does not change — one dependency does.`,
    tag: 'Engineering',
  },
];
