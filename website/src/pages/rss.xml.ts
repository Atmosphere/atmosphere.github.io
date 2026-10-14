import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { posts } from '../data/posts';

export function GET(context: APIContext) {
  return rss({
    title: 'Async IO Blog',
    description: 'Engineering notes from the team behind Atmosphere — the open-source real-time agent platform for the JVM.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.title,
      pubDate: new Date(post.date),
      description: post.excerpt.replace(/\s+/g, ' ').trim(),
      link: `/blog/${post.slug}/`,
    })),
  });
}
