// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// Placeholder: set the real domain before deploying. Canonical, Open Graph and JSON-LD URLs all derive from it.
	site: 'https://pocket-farm.example',
	// The page is one file: its stylesheet outgrew the 4 KB auto-inline threshold.
	build: { inlineStylesheets: 'always' },
});
