import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Law25Auditor } from '@nexus/brain-core';
import * as cheerio from 'cheerio';
import {
  extractTextFromFile,
  type CrawlAssetRecord,
  type CrawlJobAudit,
  type CrawlPageRecord,
  type IngestManifest,
  type IngestedFileMeta
} from './document-ingest.js';
import { closePlaywrightBrowser, headlessPagePlainText } from './web-crawl-headless.js';
import { contentTypeBase, fetchBounded } from './web-crawl-fetch.js';
import { extractLocsFromSitemapXml, looksLikeSitemapIndex } from './web-crawl-sitemap.js';
import {
  assertHttpUrlProtocol,
  assertResolvableHostIsPublic,
  hostnameMatchesRules,
  hostsAreWwwVariant,
  normalizeSeedUrl,
  parseHostRules
} from './web-crawl-ssrf.js';
import { WebCrawlIngestError, type RobotsTxtSnapshot } from './web-crawl-error.js';

const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as (url: string, robotstxt: string) => {
  isAllowed(url: string, ua?: string): boolean;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
};

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function numEnv(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function boolEnv(name: string): boolean {
  return process.env[name] === '1' || process.env[name]?.toLowerCase() === 'true';
}

function canonUrl(href: string): string {
  const u = new URL(href);
  u.hash = '';
  return u.href;
}

const ASSET_EXT = new Set(['.pdf', '.csv', '.xlsx', '.xls', '.txt', '.md']);

function pathnameLooksLikeAsset(pathname: string): boolean {
  const p = pathname.toLowerCase();
  for (const ext of ASSET_EXT) {
    if (p.endsWith(ext)) return true;
  }
  return false;
}

type RobotsHandle = ReturnType<typeof robotsParser>;

function htmlToPlainText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, template').remove();
  const title = $('title').first().text().trim();
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  const parts = [title ? `# ${title}` : '', body].filter(Boolean);
  return parts.join('\n\n').trim();
}

/** When servers omit or mislabel Content-Type, still accept obvious HTML. */
function bufferLooksLikeHtml(buf: Buffer): boolean {
  if (buf.length < 15) return false;
  const head = buf.slice(0, Math.min(buf.length, 16_384)).toString('utf8').trimStart();
  const probe = head.slice(0, 512).toLowerCase();
  if (probe.startsWith('<!doctype html')) return true;
  if (probe.startsWith('<html')) return true;
  if (/<\s*html[\s>]/.test(probe)) return true;
  return false;
}

function formatCrawlFailureHint(
  seedHref: string,
  pagesMeta: CrawlPageRecord[],
  audit: CrawlJobAudit
): string {
  const counts = new Map<string, number>();
  for (const p of pagesMeta) {
    const k = p.skippedReason ?? 'unknown';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const skipSummary = [...counts.entries()]
    .map(([k, n]) => `${k}=${n}`)
    .join(', ');
  return [
    `seed=${seedHref}`,
    `pagesTried=${pagesMeta.length}`,
    skipSummary ? `skipped={${skipSummary}}` : 'skipped={}',
    `totals robots=${audit.skippedByRobots} policy=${audit.skippedByPolicy} ssr=${audit.skippedBySsr} cap=${audit.skippedByCap}`
  ].join(' · ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface WebCrawlIngestOpts {
  dataDir: string;
  auditor: Law25Auditor;
  seedUrl: string;
  geminiApiKey?: string;
  visionOnIngest?: boolean;
  maxPages?: number;
  maxDepth?: number;
  maxTotalBytes?: number;
  attestationAccepted?: boolean;
  /** Extra host allowlist from operator (merged with WEB_CRAWL_ALLOWED_HOSTS). */
  allowedHosts?: string[];
  /**
   * When true and `WEB_CRAWL_ALLOW_IGNORE_ROBOTS=1`, do not enforce robots.txt allow/deny (testing only).
   * SSRF, scope, caps, and masking still apply.
   */
  ignoreRobots?: boolean;
}

export async function ingestWebCrawl(opts: WebCrawlIngestOpts): Promise<{
  ingestId: string;
  manifest: IngestManifest;
  maskedCombinedText: string;
  sourceFiles: { name: string; mime: string }[];
}> {
  const allowHttp = boolEnv('WEB_CRAWL_ALLOW_HTTP');
  const allowPrivate = boolEnv('WEB_CRAWL_ALLOW_PRIVATE_HOSTS');
  const requireAttestation = boolEnv('WEB_CRAWL_REQUIRE_ATTESTATION');
  const useSitemap = boolEnv('WEB_CRAWL_USE_SITEMAP');
  const headlessEnabled = boolEnv('WEB_CRAWL_HEADLESS');
  const crossOriginAssets = boolEnv('WEB_CRAWL_CROSS_ORIGIN_ASSETS');
  const allowIgnoreRobotsEnv = boolEnv('WEB_CRAWL_ALLOW_IGNORE_ROBOTS');
  const ignoreRobotsRequested = opts.ignoreRobots === true;
  const respectRobots = !(allowIgnoreRobotsEnv && ignoreRobotsRequested);
  if (ignoreRobotsRequested && !allowIgnoreRobotsEnv) {
    console.warn(
      JSON.stringify({
        event: 'web_crawl_ignore_robots_ignored',
        reason: 'WEB_CRAWL_ALLOW_IGNORE_ROBOTS not set; robots.txt still enforced'
      })
    );
  }

  if (requireAttestation && !opts.attestationAccepted) {
    throw new Error('Crawl attestation required: set attestationAccepted to true in the request body');
  }

  const seed = normalizeSeedUrl(opts.seedUrl, allowHttp);
  const seedHost = seed.hostname.toLowerCase();

  const envRules = parseHostRules(process.env.WEB_CRAWL_ALLOWED_HOSTS);
  const reqRules = (opts.allowedHosts ?? [])
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const hostRules = [...new Set([...envRules, ...reqRules])];

  if (hostRules.length && !hostnameMatchesRules(seedHost, hostRules)) {
    throw new Error('Seed URL host is not allowed by WEB_CRAWL_ALLOWED_HOSTS / allowedHosts');
  }

  const userAgent =
    process.env.WEB_CRAWL_USER_AGENT?.trim() ||
    'NexusBrainTeach/1.0 (+https://github.com/nexus-brain)';

  if (!respectRobots) {
    console.warn(
      JSON.stringify({
        event: 'web_crawl_ignore_robots_applied',
        seedUrl: seed.href,
        note: 'robots.txt allow/deny not enforced (testing only)'
      })
    );
  }

  const delayMs = numEnv('WEB_CRAWL_DELAY_MS', 1000);
  const timeoutMs = numEnv('WEB_CRAWL_TIMEOUT_MS', 25_000);
  const maxPages = opts.maxPages ?? numEnv('WEB_CRAWL_MAX_PAGES', 20);
  const maxDepth = opts.maxDepth ?? numEnv('WEB_CRAWL_MAX_DEPTH', 2);
  const maxTotalBytes = opts.maxTotalBytes ?? numEnv('WEB_CRAWL_MAX_TOTAL_MB', 30) * 1024 * 1024;
  const perUrlMaxBytes = numEnv('WEB_CRAWL_PER_URL_MAX_MB', 10) * 1024 * 1024;
  const maxAssets = numEnv('WEB_CRAWL_MAX_ASSETS', 15);
  const robotsDelayCapMs = numEnv('WEB_CRAWL_ROBOTS_CRAWL_DELAY_CAP_MS', 30_000);
  const headlessMinChars = numEnv('WEB_CRAWL_HEADLESS_MIN_CHARS', 120);
  const headlessHostRules = parseHostRules(process.env.WEB_CRAWL_HEADLESS_ALLOWED_HOSTS);
  const authHostRules = parseHostRules(process.env.WEB_CRAWL_AUTH_ORIGINS);
  const authCookie = process.env.WEB_CRAWL_AUTH_COOKIE?.trim();
  const authBearer = process.env.WEB_CRAWL_AUTH_BEARER?.trim();

  const maxSitemapFetches = numEnv('WEB_CRAWL_SITEMAP_MAX_FETCHES', 12);
  const maxSitemapUrls = numEnv('WEB_CRAWL_SITEMAP_MAX_URLS', 400);

  function inScope(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (hostRules.length) return hostnameMatchesRules(h, hostRules);
    return hostsAreWwwVariant(h, seedHost);
  }

  function assetHostOk(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (hostRules.length) {
      if (!crossOriginAssets) return hostsAreWwwVariant(h, seedHost);
      return hostnameMatchesRules(h, hostRules);
    }
    return hostsAreWwwVariant(h, seedHost);
  }

  async function assertPageUrlAllowed(u: URL): Promise<void> {
    assertHttpUrlProtocol(u);
    if (!inScope(u.hostname)) throw new Error('policy');
    if (!allowPrivate) {
      await assertResolvableHostIsPublic(u.hostname);
    }
  }

  async function assertAssetUrlAllowed(u: URL): Promise<void> {
    assertHttpUrlProtocol(u);
    if (!assetHostOk(u.hostname)) throw new Error('policy');
    if (!allowPrivate) {
      await assertResolvableHostIsPublic(u.hostname);
    }
  }

  const fetchHeaders: Record<string, string> = { 'User-Agent': userAgent };

  const htmlAccept =
    'text/html,application/xhtml+xml,application/xml;q=0.9,text/*;q=0.8,*/*;q=0.7';

  function headersForUrl(urlStr: string): Record<string, string> {
    const u = new URL(urlStr);
    if (!authHostRules.length) return { ...fetchHeaders };
    if (!hostnameMatchesRules(u.hostname, authHostRules)) return { ...fetchHeaders };
    const h: Record<string, string> = { ...fetchHeaders };
    if (authCookie) h.Cookie = authCookie;
    if (authBearer) {
      h.Authorization = /^Bearer\s|^Basic\s/i.test(authBearer) ? authBearer : `Bearer ${authBearer}`;
    }
    return h;
  }

  const robotsCache = new Map<string, RobotsHandle>();
  const robotsSnapshots = new Map<string, RobotsTxtSnapshot>();

  async function getRobotsForOrigin(origin: string): Promise<RobotsHandle> {
    const cached = robotsCache.get(origin);
    if (cached) return cached;
    const robotsUrl = new URL('/robots.txt', origin).href;
    const ru = new URL(robotsUrl);
    const robotsHost = ru.hostname.toLowerCase();
    if (!allowPrivate) {
      await assertResolvableHostIsPublic(ru.hostname);
    }
    let body = '';
    let fetchError: string | undefined;
    let httpStatus: number | undefined;
    try {
      const r = await fetchBounded(robotsUrl, {
        timeoutMs: Math.min(timeoutMs, 15_000),
        maxBytesPerResponse: 2 * 1024 * 1024,
        headers: headersForUrl(robotsUrl),
        validateBeforeFetch: async (u) => {
          assertHttpUrlProtocol(u);
          if (u.hostname.toLowerCase() !== robotsHost) {
            throw new Error('policy');
          }
          if (!allowPrivate) {
            await assertResolvableHostIsPublic(u.hostname);
          }
        }
      });
      httpStatus = r.status;
      if (r.status < 400) body = r.buffer.toString('utf8');
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
    }
    const snap: RobotsTxtSnapshot = {
      robotsUrl,
      body: body.slice(0, 48_000),
      ...(fetchError ? { fetchError } : {}),
      ...(httpStatus !== undefined && httpStatus >= 400 ? { httpStatus } : {})
    };
    robotsSnapshots.set(origin, snap);
    const robots = robotsParser(robotsUrl, body);
    robotsCache.set(origin, robots);
    return robots;
  }

  function robotsAllows(robots: RobotsHandle, url: string): boolean {
    if (!respectRobots) return true;
    return Boolean(robots.isAllowed(url, userAgent));
  }

  async function delayForPoliteness(origin: string): Promise<void> {
    let wait = delayMs;
    if (respectRobots) {
      const robots = robotsCache.get(origin) ?? (await getRobotsForOrigin(origin));
      const cd = robots.getCrawlDelay(userAgent);
      if (typeof cd === 'number' && Number.isFinite(cd) && cd > 0) {
        wait = Math.max(wait, Math.min(Math.floor(cd * 1000), robotsDelayCapMs));
      }
    }
    await sleep(wait);
  }

  const seen = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: canonUrl(seed.href), depth: 0 }];

  const pagesMeta: CrawlPageRecord[] = [];
  const assetsMeta: CrawlAssetRecord[] = [];
  const fileMetas: IngestedFileMeta[] = [];
  const textBlocks: string[] = [];

  const audit: CrawlJobAudit = {
    attestationAccepted: Boolean(opts.attestationAccepted),
    ...(respectRobots ? {} : { ignoreRobotsApplied: true }),
    skippedByRobots: 0,
    skippedByPolicy: 0,
    skippedBySsr: 0,
    skippedByCap: 0,
    pagesFetched: 0,
    assetsFetched: 0
  };

  let bytesTotal = 0;
  let pagesFetched = 0;
  let assetsFetched = 0;
  let lastHtmlFetchError: string | undefined;

  async function seedFromSitemap(): Promise<void> {
    if (!useSitemap) return;
    const origin = seed.origin;
    const smUrl = new URL('/sitemap.xml', origin).href;
    try {
      const ru = new URL(smUrl);
      await assertPageUrlAllowed(ru);
    } catch {
      return;
    }
    const robots = await getRobotsForOrigin(origin);
    if (!robotsAllows(robots, smUrl)) {
      audit.skippedByRobots += 1;
      return;
    }
    let fetches = 0;
    const toFetch: string[] = [smUrl];
    const discovered = new Set<string>();

    while (toFetch.length && fetches < maxSitemapFetches && discovered.size < maxSitemapUrls) {
      const u = toFetch.pop()!;
      fetches += 1;
      try {
        const su = new URL(u);
        await assertPageUrlAllowed(su);
      } catch {
        continue;
      }
      const r = await getRobotsForOrigin(new URL(u).origin);
      if (!robotsAllows(r, u)) {
        audit.skippedByRobots += 1;
        continue;
      }
      await delayForPoliteness(new URL(u).origin);
      let res: Awaited<ReturnType<typeof fetchBounded>>;
      try {
        res = await fetchBounded(u, {
          timeoutMs,
          maxBytesPerResponse: perUrlMaxBytes,
          headers: { ...headersForUrl(u), Accept: htmlAccept },
          validateBeforeFetch: (url) => assertPageUrlAllowed(url)
        });
      } catch {
        continue;
      }
      bytesTotal += res.buffer.length;
      if (bytesTotal > maxTotalBytes) break;
      const xml = res.buffer.toString('utf8');
      const locs = extractLocsFromSitemapXml(xml);
      if (looksLikeSitemapIndex(xml)) {
        for (const loc of locs) {
          if (toFetch.length + discovered.size >= maxSitemapUrls) break;
          if (loc.toLowerCase().endsWith('.xml')) toFetch.push(loc);
        }
      } else {
        for (const loc of locs) {
          if (discovered.size >= maxSitemapUrls) break;
          try {
            const p = new URL(loc);
            if (!inScope(p.hostname)) continue;
            discovered.add(canonUrl(loc));
            queue.push({ url: canonUrl(loc), depth: 0 });
          } catch {
            /* ignore bad loc */
          }
        }
      }
    }
  }

  await seedFromSitemap();

  async function fetchAsset(url: string): Promise<void> {
    if (assetsFetched >= maxAssets) {
      audit.skippedByCap += 1;
      assetsMeta.push({ url, mime: 'application/octet-stream', extractedChars: 0, skippedReason: 'max_assets' });
      return;
    }
    const key = canonUrl(url);
    if (seen.has(`asset:${key}`)) return;
    seen.add(`asset:${key}`);

    let u: URL;
    try {
      u = new URL(url);
      await assertAssetUrlAllowed(u);
    } catch (e) {
      if (String(e) === 'policy' || (e instanceof Error && e.message === 'policy')) {
        audit.skippedByPolicy += 1;
        assetsMeta.push({ url, mime: '', extractedChars: 0, skippedReason: 'policy' });
      } else {
        audit.skippedBySsr += 1;
        assetsMeta.push({ url, mime: '', extractedChars: 0, skippedReason: 'ssrf' });
      }
      return;
    }

    const origin = u.origin;
    const robots = await getRobotsForOrigin(origin);
    if (!robotsAllows(robots, key)) {
      audit.skippedByRobots += 1;
      assetsMeta.push({ url, mime: '', extractedChars: 0, skippedReason: 'robots' });
      return;
    }

    await delayForPoliteness(origin);

    let res: Awaited<ReturnType<typeof fetchBounded>>;
    try {
      res = await fetchBounded(key, {
        timeoutMs,
        maxBytesPerResponse: perUrlMaxBytes,
        headers: headersForUrl(key),
        validateBeforeFetch: (url) => assertAssetUrlAllowed(url)
      });
    } catch {
      assetsMeta.push({ url, mime: '', extractedChars: 0, skippedReason: 'fetch' });
      return;
    }

    bytesTotal += res.buffer.length;
    if (bytesTotal > maxTotalBytes) {
      audit.skippedByCap += 1;
      assetsMeta.push({ url, mime: '', extractedChars: 0, skippedReason: 'max_total_bytes' });
      return;
    }

    if (res.status >= 400) {
      assetsMeta.push({ url, mime: contentTypeBase(res.contentType), extractedChars: 0, skippedReason: `http_${res.status}` });
      return;
    }

    const mime = contentTypeBase(res.contentType) || 'application/octet-stream';
    const { text, visionUsed } = await extractTextFromFile(
      key,
      mime,
      res.buffer,
      opts.geminiApiKey,
      opts.visionOnIngest !== false
    );
    const block = `### Document: ${key}\n${text}`;
    textBlocks.push(block);
    const hash = sha256(res.buffer);
    fileMetas.push({
      name: key,
      mime,
      sha256: hash,
      bytes: res.buffer.length,
      extractedChars: text.length,
      visionUsed
    });
    assetsFetched += 1;
    audit.assetsFetched += 1;
    assetsMeta.push({ url: key, mime, extractedChars: text.length });
  }

  try {
    while (queue.length > 0) {
      if (pagesFetched >= maxPages) break;
      if (bytesTotal >= maxTotalBytes) break;

      const item = queue.shift()!;
      const key = canonUrl(item.url);
      if (seen.has(key)) {
        pagesMeta.push({ url: key, depth: item.depth, extractedChars: 0, skippedReason: 'duplicate' });
        continue;
      }
      seen.add(key);

      let u: URL;
      try {
        u = new URL(key);
        await assertPageUrlAllowed(u);
      } catch (e) {
        if (String(e) === 'policy' || (e instanceof Error && e.message === 'policy')) {
          audit.skippedByPolicy += 1;
          pagesMeta.push({ url: key, depth: item.depth, extractedChars: 0, skippedReason: 'policy' });
        } else {
          audit.skippedBySsr += 1;
          pagesMeta.push({ url: key, depth: item.depth, extractedChars: 0, skippedReason: 'ssrf' });
        }
        continue;
      }

      if (!inScope(u.hostname)) {
        audit.skippedByPolicy += 1;
        pagesMeta.push({ url: key, depth: item.depth, extractedChars: 0, skippedReason: 'policy' });
        continue;
      }

      const origin = u.origin;
      const robots = await getRobotsForOrigin(origin);
      if (!robotsAllows(robots, key)) {
        audit.skippedByRobots += 1;
        pagesMeta.push({ url: key, depth: item.depth, extractedChars: 0, skippedReason: 'robots' });
        continue;
      }

      await delayForPoliteness(origin);

      let res: Awaited<ReturnType<typeof fetchBounded>>;
      try {
        res = await fetchBounded(key, {
          timeoutMs,
          maxBytesPerResponse: perUrlMaxBytes,
          headers: { ...headersForUrl(key), Accept: htmlAccept },
          validateBeforeFetch: (url) => assertPageUrlAllowed(url)
        });
      } catch (e) {
        lastHtmlFetchError = e instanceof Error ? e.message : String(e);
        pagesMeta.push({ url: key, depth: item.depth, extractedChars: 0, skippedReason: 'fetch' });
        continue;
      }

      if (canonUrl(res.finalUrl) !== key) {
        try {
          const fu = new URL(res.finalUrl);
          await assertPageUrlAllowed(fu);
          const rFinal = await getRobotsForOrigin(fu.origin);
          if (!robotsAllows(rFinal, res.finalUrl)) {
            audit.skippedByRobots += 1;
            pagesMeta.push({
              url: key,
              depth: item.depth,
              extractedChars: 0,
              skippedReason: 'robots',
              statusCode: res.status
            });
            continue;
          }
        } catch (e) {
          if (String(e) === 'policy' || (e instanceof Error && e.message === 'policy')) {
            audit.skippedByPolicy += 1;
          } else {
            audit.skippedBySsr += 1;
          }
          pagesMeta.push({
            url: key,
            depth: item.depth,
            extractedChars: 0,
            skippedReason:
              String(e) === 'policy' || (e instanceof Error && e.message === 'policy') ? 'policy' : 'ssrf',
            statusCode: res.status
          });
          continue;
        }
      }

      bytesTotal += res.buffer.length;
      if (bytesTotal > maxTotalBytes) {
        audit.skippedByCap += 1;
        pagesMeta.push({ url: key, depth: item.depth, extractedChars: 0, skippedReason: 'cap' });
        break;
      }

      const mime = contentTypeBase(res.contentType);
      let isHtml = mime.includes('text/html') || mime === 'application/xhtml+xml';
      if (!isHtml && res.status < 400 && bufferLooksLikeHtml(res.buffer)) {
        isHtml = true;
      }

      const pageHost = new URL(res.finalUrl).hostname;
      const canHeadless =
        headlessEnabled &&
        (!headlessHostRules.length || hostnameMatchesRules(pageHost, headlessHostRules));

      /** When plain fetch fails or is not HTML, try Chromium (allowlisted hosts only). */
      const tryHeadlessFallback =
        canHeadless &&
        (res.status === 403 ||
          res.status === 429 ||
          res.status >= 500 ||
          (res.status < 400 && !isHtml));

      let plain: string;
      let headlessRecovered = false;
      let skipCheerio = false;

      if (res.status >= 400 || !isHtml) {
        let recovered: string | null = null;
        let headlessDetail: string | undefined;
        if (tryHeadlessFallback) {
          const headlessUa = process.env.WEB_CRAWL_HEADLESS_USER_AGENT?.trim();
          const r = await headlessPagePlainText(res.finalUrl, timeoutMs, {
            recoveryMode: true,
            ...(headlessUa ? { userAgent: headlessUa } : {})
          });
          headlessDetail = r.error;
          const t = r.text?.replace(/\s+/g, ' ').trim() ?? '';
          if (t.length >= headlessMinChars) recovered = t;
        }
        if (!recovered) {
          const base =
            res.status >= 400
              ? `HTTP ${res.status} for ${key}`
              : `Non-HTML response (Content-Type: ${res.contentType || 'unknown'}) for ${key}`;
          let detail = base;
          if (tryHeadlessFallback) {
            detail += headlessDetail
              ? ` · Headless: ${headlessDetail}`
              : ` · Headless: visible text shorter than ${headlessMinChars} chars (WEB_CRAWL_HEADLESS_MIN_CHARS)`;
          } else if (res.status >= 500) {
            if (!headlessEnabled) {
              detail +=
                ' · Enable WEB_CRAWL_HEADLESS=1, run npx playwright install chromium, and set WEB_CRAWL_HEADLESS_ALLOWED_HOSTS to try Chromium';
            } else if (!canHeadless) {
              detail += ` · Add "${pageHost}" to WEB_CRAWL_HEADLESS_ALLOWED_HOSTS for headless fallback`;
            }
          }
          lastHtmlFetchError = detail;
          pagesMeta.push({
            url: key,
            depth: item.depth,
            extractedChars: 0,
            skippedReason: res.status >= 400 ? 'fetch' : 'non_html',
            statusCode: res.status
          });
          continue;
        }
        plain = recovered;
        headlessRecovered = true;
        skipCheerio = true;
      } else {
        plain = htmlToPlainText(res.buffer.toString('utf8'));
        if (plain.length < headlessMinChars && canHeadless) {
          const headlessUa = process.env.WEB_CRAWL_HEADLESS_USER_AGENT?.trim();
          const r = await headlessPagePlainText(res.finalUrl, timeoutMs, {
            recoveryMode: false,
            ...(headlessUa ? { userAgent: headlessUa } : {})
          });
          if (r.text && r.text.length > plain.length) {
            plain = r.text.replace(/\s+/g, ' ').trim();
          }
        }
      }

      const contentBuf = headlessRecovered ? Buffer.from(plain, 'utf8') : res.buffer;
      const block = `### Page: ${key}\n${plain}`;
      textBlocks.push(block);
      const hash = sha256(contentBuf);
      fileMetas.push({
        name: key,
        mime: 'text/html',
        sha256: hash,
        bytes: contentBuf.length,
        extractedChars: plain.length
      });
      pagesFetched += 1;
      audit.pagesFetched += 1;
      pagesMeta.push({
        url: key,
        depth: item.depth,
        extractedChars: plain.length,
        statusCode: res.status,
        ...(headlessRecovered ? { recoveredViaHeadless: true } : {})
      });

      if (item.depth < maxDepth && !skipCheerio) {
        const $ = cheerio.load(res.buffer.toString('utf8'));
        const base = res.finalUrl;
        const assetJobs: Promise<void>[] = [];
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          const t = href.trim();
          if (!t || t.startsWith('#') || t.toLowerCase().startsWith('javascript:')) return;
          if (t.toLowerCase().startsWith('mailto:') || t.toLowerCase().startsWith('tel:')) return;
          let next: URL;
          try {
            next = new URL(t, base);
          } catch {
            return;
          }
          if (next.protocol !== 'http:' && next.protocol !== 'https:') return;
          const nextKey = canonUrl(next.href);
          if (pathnameLooksLikeAsset(next.pathname)) {
            if (assetHostOk(next.hostname)) {
              assetJobs.push(fetchAsset(nextKey));
            }
            return;
          }
          if (inScope(next.hostname)) {
            queue.push({ url: nextKey, depth: item.depth + 1 });
          }
        });
        await Promise.all(assetJobs);
      }
    }

  } finally {
    await closePlaywrightBrowser();
  }

  if (!textBlocks.length) {
    const hint = formatCrawlFailureHint(seed.href, pagesMeta, audit);
    const fetchDetail = lastHtmlFetchError
      ? ` Last error: ${lastHtmlFetchError}.`
      : '';
    throw new WebCrawlIngestError(
      `No crawlable HTML content was retrieved (check robots.txt, scope, Content-Type, or seed URL).${fetchDetail} ${hint}`,
      {
        seedUrl: seed.href,
        userAgent,
        pagesTried: pagesMeta.map((p) => ({
          url: p.url,
          depth: p.depth,
          skippedReason: p.skippedReason,
          statusCode: p.statusCode
        })),
        crawlJob: { ...audit },
        robotsTxtByOrigin: Object.fromEntries(robotsSnapshots),
        ...(lastHtmlFetchError ? { lastHtmlFetchError } : {})
      }
    );
  }

  const ingestId = randomUUID();
  const baseDir = join(opts.dataDir, 'uploads', ingestId);
  await mkdir(baseDir, { recursive: true });

  const combinedRaw = textBlocks.join('\n\n---\n\n');
  const masked = opts.auditor.scanAndMask(combinedRaw);
  opts.auditor.record('specialist_input', combinedRaw.length, masked);

  await writeFile(join(baseDir, 'masked.txt'), masked.text, 'utf8');

  const manifest: IngestManifest = {
    ingestId,
    createdAt: new Date().toISOString(),
    files: fileMetas,
    maskedTextChars: masked.text.length,
    source: 'web_crawl',
    seedUrl: seed.href,
    pages: pagesMeta,
    assets: assetsMeta,
    crawlJob: audit
  };
  await writeFile(join(baseDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const sourceFiles = fileMetas.map((f) => ({ name: f.name, mime: f.mime }));

  return {
    ingestId,
    manifest,
    maskedCombinedText: masked.text,
    sourceFiles
  };
}
