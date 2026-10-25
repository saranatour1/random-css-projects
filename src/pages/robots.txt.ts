import type { APIRoute } from 'astro'

// Built from `site` in astro.config.mjs, so the sitemap line follows the real domain. AI crawlers are named so the
// allow is explicit, not inferred from the wildcard.
const BOTS = ['*', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent', 'Amazonbot',
  'Bytespider', 'cohere-ai', 'DuckAssistBot', 'MistralAI-User', 'Twitterbot', 'facebookexternalhit', 'Slackbot', 'Discordbot']

export const GET: APIRoute = ({ site }) =>
  new Response(`${BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`).join('\n')}\nSitemap: ${new URL('/sitemap.xml', site)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
