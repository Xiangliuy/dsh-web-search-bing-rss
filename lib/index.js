/**
 * dsh-web-search-bing-rss — a free, no-API-key web search provider for the
 * DeepSeek Harness web capability seam (`ctx.web`).
 *
 * It registers a Bing RSS search provider (`id: "bing-rss"`) alongside the
 * official DeepSeek provider. Bing's `…/search?q=<query>&format=rss` endpoint
 * returns a small RSS 2.0 feed of organic results — no key, no billing, no
 * account — so this provider is always `available()` once registered and wins
 * auto-selection when no other provider is usable (e.g. no DeepSeek API key
 * configured). When the DeepSeek provider IS available, configure
 * `DSH_WEB_SEARCH_PROVIDER=bing-rss` (or the settings section) to prefer this
 * free provider, or leave it unset to use DeepSeek.
 *
 * @module @deepseek-ai/dsh-web-search-bing-rss
 */

import z from '@deepseek-ai/schemastery';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import {
  BING_RSS_DEFAULT_BASE_URL,
  BING_RSS_DEFAULT_MARKET,
  BING_RSS_DEFAULT_MAX_RESULTS,
  BING_RSS_DEFAULT_TIMEOUT_MS,
  BING_RSS_DEFAULT_USER_AGENT,
  BING_RSS_PROVIDER_ID,
  BingRssSearchProvider,
  resolveProviderOptions,
} from './provider.js';

/** Cordis plugin name used by loader diagnostics. */
const name = 'web-search-bing-rss';

/** The web seam this provider registers into. */
const inject = ['web'];

/** Environment variable overriding the Bing RSS endpoint base. */
const BING_RSS_BASE_URL_ENV = 'DSH_BING_RSS_BASE_URL';

/** Settings namespace carrying this provider's endpoint and tuning config. */
const WEB_SEARCH_BING_RSS_SETTINGS_NAMESPACE = settingsNamespace('web-search-bing-rss');

/**
 * Plugin config schema. Every field is optional — the defaults make the
 * provider work with no configuration at all.
 */
const Config = z.object({
  /** Literal endpoint base; `/search` is appended. Empty = default Bing. */
  baseURL: z.string(),
  /** Desktop UA sent on every request; empty = built-in default. */
  userAgent: z.string(),
  /** Bing market/locale (`mkt`/`setlang`), e.g. `en-US`, `zh-CN`. Empty disables the parameter. */
  market: z.string(),
  /** Per-request timeout in ms. */
  timeoutMs: z.number().step(1).min(1),
  /** Defensive upper bound on parsed `<item>` elements. */
  maxResults: z.number().step(1).min(1),
});

/**
 * Resolve one operation's options from the current settings section,
 * environment, and defaults. Environment wins over defaults but yields to an
 * explicit section value; the section's `setSource` callback keeps the thunk
 * reactive to live settings edits.
 *
 * @param {object} ctx - plugin context supplying the environment plane.
 * @param {object} section - the currently authoritative settings section.
 * @returns the options for one search.
 */
function resolveOptions(ctx, section) {
  const env = launchEnvironmentOf(ctx);
  const envBase = env.get(BING_RSS_BASE_URL_ENV)?.value;
  return resolveProviderOptions({
    baseURL: section.baseURL ?? envBase ?? BING_RSS_DEFAULT_BASE_URL,
    userAgent: section.userAgent ?? BING_RSS_DEFAULT_USER_AGENT,
    market: section.market ?? BING_RSS_DEFAULT_MARKET,
    timeoutMs: section.timeoutMs ?? BING_RSS_DEFAULT_TIMEOUT_MS,
    maxResults: section.maxResults ?? BING_RSS_DEFAULT_MAX_RESULTS,
  });
}

/**
 * Register the Bing RSS search provider with `ctx.web`. The provider is
 * fiber-scoped: its disposer unregisters it when the calling fiber disposes.
 */
function apply(ctx, config) {
  let current = () => config;
  installSettingsSection(ctx, WEB_SEARCH_BING_RSS_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {},
  });
  ctx.web.registerSearchProvider(
    new BingRssSearchProvider(() => resolveOptions(ctx, current())),
  );
}

export {
  BING_RSS_BASE_URL_ENV,
  BING_RSS_DEFAULT_BASE_URL,
  BING_RSS_DEFAULT_MARKET,
  BING_RSS_DEFAULT_MAX_RESULTS,
  BING_RSS_DEFAULT_TIMEOUT_MS,
  BING_RSS_DEFAULT_USER_AGENT,
  BING_RSS_PROVIDER_ID,
  BING_RSS_SETTINGS_NAMESPACE as WEB_SEARCH_BING_RSS_SETTINGS_NAMESPACE,
  BingRssSearchProvider,
  Config,
  apply,
  inject,
  name,
  resolveOptions as resolveBingRssOptions,
};
