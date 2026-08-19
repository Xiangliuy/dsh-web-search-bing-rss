/**
 * Self-contained test for the Bing RSS provider's pure functions and a live
 * network search. Run with: node lib/test-provider.mjs
 *
 * This file imports from ./provider.js, which imports @deepseek-ai/dsh-web.
 * The junction-linked node_modules lets Node resolve the bare specifiers.
 *
 * Exit code 0 = all assertions passed; non-zero = a failure printed to stderr.
 */
import {
  BING_RSS_PROVIDER_ID,
  BING_RSS_DEFAULT_BASE_URL,
  BING_RSS_DEFAULT_USER_AGENT,
  BING_RSS_DEFAULT_MARKET,
  BingRssSearchProvider,
  buildSearchUrl,
  decodeEntities,
  firstElementText,
  parseBingRss,
  parsePubDate,
  resolveProviderOptions,
  stripHtml,
} from './provider.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg ?? ''}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function assertOk(cond, msg) {
  assert(cond, msg);
}

function group(name) {
  console.log(`▶ ${name}`);
}

// ─── decodeEntities ─────────────────────────────────────────────────────────

group('decodeEntities');
{
  // &amp;→&, &lt;→<, &gt;→>, &quot;→", &apos;→'  ⇒  &<>"'
  assertEqual(decodeEntities('&amp;&lt;&gt;&quot;&apos;'), '&<>"\'', 'five XML entities');
  assertEqual(decodeEntities('&#65;&#x42;'), 'AB', 'numeric char refs');
  assertEqual(decodeEntities('Tom &amp; Jerry &lt;show&gt;'), 'Tom & Jerry <show>', 'mixed content');
  assertEqual(decodeEntities(undefined), '', 'undefined');
  assertEqual(decodeEntities(null), '', 'null');
  assertEqual(decodeEntities(''), '', 'empty string');
  assertEqual(decodeEntities('&copy;'), '&copy;', 'unknown entity left as-is');
}

// ─── stripHtml ──────────────────────────────────────────────────────────────

group('stripHtml');
{
  assertEqual(stripHtml('<b>hello</b> world'), 'hello world', 'strip <b>');
  assertEqual(stripHtml('a<br>b<i>c</i>d'), 'a b c d', 'strip <br> and <i>');
  assertEqual(stripHtml(undefined), '', 'undefined');
  assertEqual(stripHtml(null), '', 'null');
}

// ─── parsePubDate ───────────────────────────────────────────────────────────

group('parsePubDate');
{
  assertEqual(parsePubDate('Tue, 18 Aug 2026 13:03:00 GMT'), '2026-08-18T13:03:00.000Z', 'RFC-822');
  assertEqual(parsePubDate('周二, 18 8月 2026 13:03:00 GMT'), '2026-08-18T13:03:00.000Z', 'locale-flavored');
  assertEqual(parsePubDate('not a date'), undefined, 'unparseable');
  assertEqual(parsePubDate(''), undefined, 'empty');
  assertEqual(parsePubDate(undefined), undefined, 'undefined');
}

// ─── firstElementText ───────────────────────────────────────────────────────

group('firstElementText');
{
  assertEqual(firstElementText('<title>Hello</title>', 'title'), 'Hello', 'simple');
  assertEqual(firstElementText('<link href="x">Text</link>', 'link'), 'Text', 'with attrs');
  assertEqual(firstElementText('<title>A &amp; B</title>', 'title'), 'A & B', 'entity decode');
  assertEqual(firstElementText('<channel></channel>', 'title'), '', 'absent tag');
  assertEqual(firstElementText('<description>line1\nline2</description>', 'description'), 'line1\nline2', 'multi-line');
}

// ─── buildSearchUrl ─────────────────────────────────────────────────────────

group('buildSearchUrl');
{
  const url = buildSearchUrl({ baseURL: 'https://www.bing.com', market: 'en-US' }, 'hello world');
  assertOk(url.startsWith('https://www.bing.com/search?'), `url starts with search? in ${url}`);
  assertOk(url.includes('q=hello+world'), `q=hello+world in ${url}`);
  assertOk(url.includes('format=rss'), `format=rss in ${url}`);
  assertOk(url.includes('mkt=en-US'), `mkt=en-US in ${url}`);
  assertOk(url.includes('setlang=en-US'), `setlang=en-US in ${url}`);

  const urlNoMarket = buildSearchUrl({ baseURL: 'https://www.bing.com', market: '' }, 'test');
  assertOk(!urlNoMarket.includes('mkt='), `no mkt= in ${urlNoMarket}`);
  assertOk(!urlNoMarket.includes('setlang='), `no setlang= in ${urlNoMarket}`);

  const urlTrimmed = buildSearchUrl({ baseURL: 'https://www.bing.com///', market: '' }, 'x');
  assertOk(urlTrimmed.startsWith('https://www.bing.com/search?'), `trimmed base in ${urlTrimmed}`);

  const urlEncoded = buildSearchUrl({ baseURL: 'https://www.bing.com', market: '' }, 'a&b=c+d');
  assertOk(urlEncoded.includes('q=a%26b%3Dc%2Bd'), `encoded query in ${urlEncoded}`);
}

// ─── parseBingRss ───────────────────────────────────────────────────────────

group('parseBingRss');
{
  const SAMPLE_RSS =
    '<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>必应：OpenAI</title><link>http://www.bing.com:80/search?q=OpenAI</link><description>搜索结果</description>' +
    '<item><title>ChatGPT: Chat &amp; Code</title><link>https://chatgpt.com/</link><description>Use ChatGPT to answer questions.</description><pubDate>Tue, 18 Aug 2026 13:03:00 GMT</pubDate></item>' +
    '<item><title>OpenAI</title><link>https://openai.com/</link><description>OpenAI&apos;s mission.</description><pubDate>Tue, 18 Aug 2026 19:08:00 GMT</pubDate></item>' +
    '<item><title>No Link Item</title><description>This item has no link and should be dropped.</description></item>' +
    '</channel></rss>';

  const sources = parseBingRss(SAMPLE_RSS, 10);
  assertEqual(sources.length, 2, 'drops the item without a link');
  assertEqual(sources[0].url, 'https://chatgpt.com/', 'first url');
  assertEqual(sources[0].title, 'ChatGPT: Chat & Code', 'first title (entity decoded)');
  assertEqual(sources[0].snippet, 'Use ChatGPT to answer questions.', 'first snippet');
  assertEqual(sources[0].publishedAt, '2026-08-18T13:03:00.000Z', 'first publishedAt');
  assertEqual(sources[1].snippet, "OpenAI's mission.", 'second snippet (entity decoded)');

  assertEqual(parseBingRss(SAMPLE_RSS, 1).length, 1, 'respects maxResults');
  assertDeepEqual(parseBingRss('<rss></rss>', 10), [], 'empty RSS');
  assertDeepEqual(parseBingRss('not xml at all', 10), [], 'malformed XML');
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else { failed++; console.error(`  FAIL: ${msg}\n    expected: ${e}\n    actual:   ${a}`); }
}

// ─── resolveProviderOptions ─────────────────────────────────────────────────

group('resolveProviderOptions');
{
  const opts = resolveProviderOptions({});
  assertEqual(opts.baseURL, BING_RSS_DEFAULT_BASE_URL, 'default baseURL');
  assertEqual(opts.userAgent, BING_RSS_DEFAULT_USER_AGENT, 'default userAgent');
  assertEqual(opts.market, BING_RSS_DEFAULT_MARKET, 'default market');
  assertOk(opts.timeoutMs > 0, 'default timeoutMs > 0');
  assertOk(opts.maxResults > 0, 'default maxResults > 0');

  const custom = resolveProviderOptions({
    baseURL: 'https://cn.bing.com/',
    userAgent: 'TestUA/1.0',
    market: 'zh-CN',
    timeoutMs: 5000,
    maxResults: 5,
  });
  assertEqual(custom.baseURL, 'https://cn.bing.com', 'custom baseURL (trailing slash trimmed)');
  assertEqual(custom.userAgent, 'TestUA/1.0', 'custom userAgent');
  assertEqual(custom.market, 'zh-CN', 'custom market');
  assertEqual(custom.timeoutMs, 5000, 'custom timeoutMs');
  assertEqual(custom.maxResults, 5, 'custom maxResults');

  const invalid = resolveProviderOptions({ timeoutMs: -1, maxResults: 0 });
  assertOk(invalid.timeoutMs > 0, 'invalid timeoutMs falls back');
  assertOk(invalid.maxResults > 0, 'invalid maxResults falls back');

  const emptyMarket = resolveProviderOptions({ market: '' });
  assertEqual(emptyMarket.market, '', 'empty market respected');
}

// ─── BingRssSearchProvider basics ───────────────────────────────────────────

group('BingRssSearchProvider');
{
  const provider = new BingRssSearchProvider(() => ({}));
  assertEqual(provider.id, BING_RSS_PROVIDER_ID, 'provider id');
  assertEqual(provider.available(), true, 'available() is always true');
}

// ─── live network test ──────────────────────────────────────────────────────

group('live Bing RSS search');
{
  let liveResult = null;
  let liveError = null;
  try {
    const provider = new BingRssSearchProvider(() => resolveProviderOptions({}));
    liveResult = await provider.search({ query: 'OpenAI', maxResults: 5 });
  } catch (e) {
    liveError = e;
  }
  if (liveError) {
    console.log(`  ⚠ live test skipped (${liveError.message ?? liveError})`);
  } else if (liveResult) {
    assertOk(Array.isArray(liveResult.sources), 'sources is an array');
    assertEqual(liveResult.truncated, false, 'truncated is false');
    assertOk(liveResult.sources.length > 0, 'at least one source returned');
    if (liveResult.sources.length > 0) {
      const first = liveResult.sources[0];
      assertOk(typeof first.url === 'string' && first.url.startsWith('http'), `first source URL valid: ${first.url}`);
      console.log(`  ✓ live search returned ${liveResult.sources.length} results`);
      console.log(`    first: ${first.title ?? '(no title)'} — ${first.url}`);
      if (first.snippet) console.log(`    snippet: ${first.snippet.slice(0, 80)}${first.snippet.length > 80 ? '…' : ''}`);
    }
  }
}

// ─── summary ────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('❌ TESTS FAILED');
  process.exit(1);
} else {
  console.log('✅ ALL TESTS PASSED');
}
