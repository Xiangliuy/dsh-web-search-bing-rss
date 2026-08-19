/**
 * Bing RSS search provider for the DeepSeek Harness web capability seam (`ctx.web`).
 *
 * This provider queries Bing's free, no-API-key RSS search endpoint
 * (`https://www.bing.com/search?q=<query>&format=rss`) and normalizes the
 * returned RSS 2.0 feed into the `WebSearchResult` shape expected by
 * `@deepseek-ai/dsh-web`. It is a deliberately minimal, dependency-free
 * implementation: only the Node.js global `fetch` and a hand-rolled RSS
 * parser are used, so the provider loads anywhere the harness runs.
 *
 * Design notes:
 * - `available()` is a cheap local check that never touches the network. It
 *   returns `true` whenever the provider is registered (no API key is
 *   required), so it participates in `ctx.web`'s auto-selection: when no
 *   other search provider is usable, this one is selected automatically.
 * - The endpoint redirects `www.bing.com` → `cn.bing.com` regionally; we set
 *   `redirect: 'follow'` so the single fetch resolves the final feed.
 * - A best-effort `User-Agent` is sent because some Bing edge paths return a
 *   consent/cookie interstitial to UA-less clients; a desktop browser UA
 *   avoids it. The UA is configurable.
 * - RSS parsing is defensive: malformed feeds, missing fields, non-UTF-8
 *   bodies, and HTTP errors are all mapped to `WebError` with stable codes.
 * - `pubDate` is parsed to ISO-8601 when possible (the seam's
 *   `WebSearchSource.publishedAt` is documented as ISO-8601); an unparseable
 *   date is dropped rather than forcing a lie.
 * - HTML entities in title/description are decoded to plain text for the
 *   snippet, matching how `dsh-tool-web` renders DeepSeek/Exa snippets.
 *
 * @module @deepseek-ai/dsh-web-search-bing-rss/provider
 */

/**
 * Stable id this provider registers under. Keep it lowercase-kebab and unique
 * within the search capability kind (it shares the registry with
 * `deepseek-official`, `exa`, etc.).
 */
const BING_RSS_PROVIDER_ID = 'bing-rss';

/**
 * Default Bing RSS search endpoint. The `q` and `format=rss` query parameters
 * are appended by {@link buildSearchUrl}. A regional redirect
 * (www.bing.com → cn.bing.com) is followed automatically by `fetch`.
 */
const BING_RSS_DEFAULT_BASE_URL = 'https://www.bing.com';

/**
 * Default desktop User-Agent. Bing's RSS endpoint answers UA-less requests,
 * but a desktop UA avoids the occasional consent interstitial on regional
 * edges. Configurable via `userAgent`.
 */
const BING_RSS_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Default per-request timeout (ms). The provider's `fetch` is also bounded by
 * the tool-call timeout the harness attaches, but this backstop prevents a
 * stuck Bing edge from hanging the provider past the user's patience.
 */
const BING_RSS_DEFAULT_TIMEOUT_MS = 15000;

/**
 * Default locale/market parameter appended to the request (`mkt=en-US`). Bing
 * RSS respects `mkt` and `setlang` to bias results; an empty string disables
 * the parameter. Configurable via `market`.
 */
const BING_RSS_DEFAULT_MARKET = 'en-US';

/**
 * Default maximum results to extract from the feed. Bing RSS returns a small
 * number of items (typically 3–10 per query); the seam enforces
 * `request.maxResults` on top, so this is only a defensive upper bound on how
 * many `<item>` elements we parse.
 */
const BING_RSS_DEFAULT_MAX_RESULTS = 10;

/**
 * Resolve one operation's options from the plugin config. Environment
 * fallbacks are resolved here so the provider never retains a stale snapshot.
 *
 * @param {object} config - the plugin's resolved config section.
 * @returns the options for one search.
 */
function resolveProviderOptions(config) {
  return {
    baseURL: (config.baseURL ?? BING_RSS_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    userAgent:
      typeof config.userAgent === 'string' && config.userAgent.length > 0
        ? config.userAgent
        : BING_RSS_DEFAULT_USER_AGENT,
    market:
      typeof config.market === 'string'
        ? config.market // empty string is a valid "no market" sentinel
        : BING_RSS_DEFAULT_MARKET,
    timeoutMs:
      Number.isInteger(config.timeoutMs) && config.timeoutMs > 0
        ? config.timeoutMs
        : BING_RSS_DEFAULT_TIMEOUT_MS,
    maxResults:
      Number.isInteger(config.maxResults) && config.maxResults > 0
        ? config.maxResults
        : BING_RSS_DEFAULT_MAX_RESULTS,
  };
}

/**
 * Build the Bing RSS search URL for a query.
 *
 * @param {object} options - resolved provider options.
 * @param {string} query - the user's search query.
 * @returns the fully-qualified URL.
 */
function buildSearchUrl(options, query) {
  const base = (options.baseURL ?? '').replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('format', 'rss');
  if (options.market.length > 0) {
    params.set('mkt', options.market);
    params.set('setlang', options.market);
  }
  return `${base}/search?${params.toString()}`;
}

/**
 * Decode the handful of XML/RSS character references and the common HTML
 * named entities that appear in Bing RSS title/description fields. This is
 * intentionally minimal — Bing's feed is UTF-8 and uses numeric references
 * plus the five XML predefined entities; anything beyond that is left as-is
 * rather than pulling in a full HTML entity table.
 *
 * @param {string} text - the raw RSS field text.
 * @returns the decoded text.
 */
function decodeEntities(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

/**
 * Strip HTML tags from an RSS description snippet. Bing descriptions are
 * usually plain text but occasionally contain `<b>`/`<br>` markup; a
 * whitespace-collapsing tag strip keeps the snippet readable for the model
 * without a full HTML parser.
 *
 * @param {string} html - the raw description HTML.
 * @returns a single-line plain-text snippet.
 */
function stripHtml(html) {
  if (html === undefined || html === null) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an RSS pubDate (RFC-822/RFC-1123, e.g. "Tue, 18 Aug 2026 13:03:00 GMT"
 * or the locale-flavored "周二, 18 8月 2026 13:03:00 GMT" Bing sometimes
 * emits) into an ISO-8601 timestamp. Returns `undefined` when the date cannot
 * be parsed, so the seam's optional `publishedAt` is simply omitted rather
 * than carrying a bogus value.
 *
 * @param {string} pubDate - the raw RSS pubDate text.
 * @returns the ISO-8601 timestamp, or `undefined`.
 */
function parsePubDate(pubDate) {
  if (typeof pubDate !== 'string' || pubDate.length === 0) return undefined;
  // First try the standard Date parser, which handles RFC-822 dates directly.
  const ms = Date.parse(pubDate);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  // Bing sometimes emits locale-flavored dates like "周二, 18 8月 2026 13:03:00 GMT"
  // (Chinese weekday "周二" = Tuesday, "8月" = August). Strip non-ASCII tokens,
  // then rebuild an RFC-822-style date: the day-of-week prefix is optional for
  // Date.parse, so we drop it; "8月" becomes "Aug" via a CJK month map.
  const CJK_MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const RFC822_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let normalized = pubDate;
  for (let i = 0; i < CJK_MONTHS.length; i++) {
    normalized = normalized.replace(CJK_MONTHS[i], RFC822_MONTHS[i]);
  }
  // Strip any remaining non-ASCII (weekday names like "周二") and collapse whitespace.
  normalized = normalized.replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, ' ').trim();
  // Remove a leading comma left by a stripped weekday (" , 18 Aug 2026" → "18 Aug 2026").
  normalized = normalized.replace(/^,?\s*/, '');
  if (normalized.length > 0 && normalized !== pubDate) {
    const ms2 = Date.parse(normalized);
    if (!Number.isNaN(ms2)) return new Date(ms2).toISOString();
  }
  return undefined;
}

/**
 * Extract the inner text of the first `<tag>…</tag>` element within a string.
 * Returns the empty string when the tag is absent. Used for the channel-level
 * fields (title, description) and the per-item fields (title, link,
 * description, pubDate). A hand-rolled scan avoids a full XML parser
 * dependency while tolerating Bing's occasional quirks (namespaces, stray
 * whitespace, self-closing siblings).
 *
 * @param {string} xml - the RSS XML fragment to scan.
 * @param {string} tag - the tag name (without namespace).
 * @returns the decoded inner text, or the empty string.
 */
function firstElementText(xml, tag) {
  // Match `<tag` followed by optional attributes and `>`, then lazily to the
  // first `</tag>`. The `s` flag lets `.` span newlines in multi-line
  // descriptions.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(re);
  return match ? decodeEntities(match[1].trim()) : '';
}

/**
 * Parse Bing RSS search items from the channel body. Each `<item>` becomes a
 * `WebSearchSource` with `url` (required), and optional `title`, `snippet`,
 * and `publishedAt`. Items without a usable `<link>` are dropped — the seam
 * requires a URL on every source.
 *
 * @param {string} rssXml - the full RSS XML body.
 * @param {number} maxResults - upper bound on parsed items.
 * @returns the parsed sources.
 */
function parseBingRss(rssXml, maxResults) {
  const sources = [];
  // Split on `<item>` openings. The leading segment (channel metadata) is
  // skipped by starting from the first `<item>`.
  const itemRe = /<item\b[^>]*>/gi;
  let openMatch;
  const opens = [];
  while ((openMatch = itemRe.exec(rssXml)) !== null) opens.push(openMatch.index);
  for (let i = 0; i < opens.length && sources.length < maxResults; i++) {
    const start = opens[i];
    const end = i + 1 < opens.length ? opens[i + 1] : rssXml.length;
    const fragment = rssXml.slice(start, end);
    const link = firstElementText(fragment, 'link');
    if (link.length === 0) continue;
    const title = firstElementText(fragment, 'title');
    const description = firstElementText(fragment, 'description');
    const pubDate = parsePubDate(firstElementText(fragment, 'pubdate'));
    const source = { url: link };
    if (title.length > 0) source.title = title;
    const snippet = stripHtml(description);
    if (snippet.length > 0) source.snippet = snippet;
    if (pubDate !== undefined) source.publishedAt = pubDate;
    sources.push(source);
  }
  return sources;
}

/**
 * The Bing RSS search provider. Registered with `ctx.web` via
 * `registerSearchProvider`. The constructor takes a thunk so the options are
 * re-resolved per search — matching the DeepSeek provider's pattern and
 * keeping the provider reactive to settings changes without re-registration.
 */
class BingRssSearchProvider {
  /** @param {() => object} resolveOptions - thunk returning the current options snapshot. */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions;
  }

  /** Stable id used by the web seam's provider registry. */
  id = BING_RSS_PROVIDER_ID;

  /**
   * Cheap local usability check. This provider needs no API key and no
   * network preflight, so it is always available once registered. The seam
   * uses `available()` to resolve auto-selection when no provider id is
   * configured: when the DeepSeek provider has no key, it returns `false`
   * and this provider wins automatically.
   * @returns true.
   */
  available() {
    return true;
  }

  /**
   * Run one Bing RSS search.
   *
   * @param {object} request - the seam's search request (`query`, optional
   *   `maxResults`).
   * @param {AbortSignal} [signal] - cancellation signal forwarded from the
   *   tool layer.
   * @returns the normalized search result.
   * @throws {WebError} on network failure, non-200 response, or an
   *   unprocessable feed.
   */
  async search(request, signal) {
    const options = this.resolveOptions();
    const query = String(request?.query ?? '').trim();
    if (query.length === 0) {
      throw new WebError('bing-rss: query must be a non-empty string', 'WEB_PROVIDER_ERROR');
    }
    const maxResults =
      Number.isInteger(request?.maxResults) && request.maxResults > 0
        ? Math.min(request.maxResults, options.maxResults)
        : options.maxResults;
    const url = buildSearchUrl(options, query);

    // Attach the provider's own timeout as an abort signal. If the caller
    // already passed a signal, race the two: the first to abort wins, and we
    // detect the caller's abort to surface `WEB_ABORTED` rather than a
    // generic timeout.
    const callerAborted = () => signal?.aborted === true;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), options.timeoutMs);
    const onCallerAbort = () => timeoutController.abort();
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw new WebError('bing-rss search aborted', 'WEB_ABORTED', {
          cause: signal.reason,
        });
      }
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            accept: 'application/rss+xml, application/xml, text/xml, */*',
            'accept-language': options.market.length > 0 ? options.market : 'en-US,en;q=0.9',
            'user-agent': options.userAgent,
          },
          signal: timeoutController.signal,
        });
      } catch (error) {
        if (callerAborted()) throw new WebError('bing-rss search aborted', 'WEB_ABORTED', { cause: signal?.reason });
        throw new WebError(`bing-rss search request failed: ${String(error?.message ?? error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
      }
      if (callerAborted()) throw new WebError('bing-rss search aborted', 'WEB_ABORTED', { cause: signal?.reason });
      if (!response.ok) {
        let detail = '';
        try {
          const text = await response.text();
          detail = text.slice(0, 300);
        } catch {
          /* swallow — the status code is enough for the error */
        }
        throw new WebError(
          `bing-rss search failed (HTTP ${response.status})${detail.length > 0 ? `: ${detail}` : ''}`,
          'WEB_PROVIDER_ERROR',
        );
      }
      const body = await response.text();
      if (callerAborted()) throw new WebError('bing-rss search aborted', 'WEB_ABORTED', { cause: signal?.reason });
      const sources = parseBingRss(body, maxResults);
      // Bing RSS returns no provider-generated answer text; the model-facing
      // tool composes its own answer from the sources. `truncated` is always
      // false here because the seam enforces `maxResults` on top.
      return { sources, truncated: false };
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

/**
 * A `WebError`-compatible error class. The `dsh-web` seam does not require
 * errors to be instances of its own `WebError`; it only surfaces the `message`
 * and `code` properties to tool execution. Defining a local class keeps this
 * provider self-contained — it loads from an agent-preset directory that may
 * not have `@deepseek-ai/dsh-web` resolvable in its own node_modules tree,
 * while still producing the same `{ message, code, cause }` shape the seam
 * and `dsh-tool-web` expect.
 */
class WebError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = 'WebError';
    this.code = code;
  }
}

export {
  BING_RSS_DEFAULT_BASE_URL,
  BING_RSS_DEFAULT_MARKET,
  BING_RSS_DEFAULT_MAX_RESULTS,
  BING_RSS_DEFAULT_TIMEOUT_MS,
  BING_RSS_DEFAULT_USER_AGENT,
  BING_RSS_PROVIDER_ID,
  BingRssSearchProvider,
  buildSearchUrl,
  decodeEntities,
  firstElementText,
  parseBingRss,
  parsePubDate,
  resolveProviderOptions,
  stripHtml,
};
