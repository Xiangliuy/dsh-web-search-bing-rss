/**
 * Lightweight cordis plugin entry for the Bing RSS search provider, designed
 * to be loaded directly from an agent preset directory via `name: ./entry.mjs`
 * — no npm package installation required. It depends only on the `web` service
 * (provided by the host composition's `@deepseek-ai/dsh-web`), so it resolves
 * `@deepseek-ai/dsh-web` through the harness's own node_modules tree.
 *
 * Configuration is inline (passed through the preset's `config:` map) or via
 * environment variables, NOT through the settings service — keeping this entry
 * free of `@deepseek-ai/dsh-settings` / `@deepseek-ai/dsh-launch-environment`
 * dependencies that a preset directory cannot resolve.
 *
 * @module @deepseek-ai/dsh-web-search-bing-rss/entry
 */

import { BingRssSearchProvider, resolveProviderOptions } from './provider.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'web-search-bing-rss';

/** The web seam this provider registers into. */
const inject = ['web'];

/** Default config; every field can be overridden by the preset's `config:` map. */
const DEFAULTS = {
  baseURL: process.env.DSH_BING_RSS_BASE_URL || 'https://www.bing.com',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  market: 'en-US',
  timeoutMs: 15000,
  maxResults: 10,
};

/**
 * Register the Bing RSS search provider with `ctx.web`. The provider is
 * fiber-scoped: its disposer unregisters it when the calling fiber disposes.
 * Config is read once at apply time from the preset's `config:` map, with
 * environment variable fallbacks for `baseURL`.
 */
function apply(ctx, config) {
  const merged = { ...DEFAULTS, ...(config || {}) };
  ctx.web.registerSearchProvider(
    new BingRssSearchProvider(() => resolveProviderOptions(merged)),
  );
}

export { name, inject, apply };
