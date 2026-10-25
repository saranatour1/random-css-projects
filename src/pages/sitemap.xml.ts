import type { APIRoute } from 'astro'

// One page, so one URL. Built from `site` in astro.config.mjs.
export const GET: APIRoute = ({ site }) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${new URL('/', site)}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  )
