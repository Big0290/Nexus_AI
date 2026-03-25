import type { Browser } from 'playwright';

let browserSingleton: Browser | null = null;

/** Browser-like UA for sites that return 5xx or block non-browser `fetch`. */
const DEFAULT_HEADLESS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function getPlaywrightBrowser(): Promise<Browser | null> {
  try {
    if (browserSingleton) return browserSingleton;
    const { chromium } = await import('playwright');
    browserSingleton = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled']
    });
    return browserSingleton;
  } catch {
    return null;
  }
}

export async function closePlaywrightBrowser(): Promise<void> {
  if (!browserSingleton) return;
  try {
    await browserSingleton.close();
  } catch {
    /* ignore */
  }
  browserSingleton = null;
}

export type HeadlessPlainTextResult = {
  text: string | null;
  /** Set when Playwright could not return usable text (install issue, navigation error, empty body). */
  error?: string;
};

/**
 * Render URL in headless Chromium and return visible text.
 * @param recoveryMode — after HTTP errors / non-HTML: wait for `load` and allow a longer navigation timeout.
 */
export async function headlessPagePlainText(
  url: string,
  timeoutMs: number,
  opts?: { userAgent?: string; recoveryMode?: boolean }
): Promise<HeadlessPlainTextResult> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    return {
      text: null,
      error: 'Playwright Chromium not available — from server/: run npx playwright install chromium'
    };
  }

  const recovery = opts?.recoveryMode === true;
  const navTimeout = recovery
    ? Math.min(Math.max(timeoutMs * 2, 30_000), 120_000)
    : Math.min(timeoutMs, 120_000);
  const waitUntil = recovery ? ('load' as const) : ('domcontentloaded' as const);

  const context = await browser.newContext({
    userAgent: opts?.userAgent?.trim() || DEFAULT_HEADLESS_UA,
    locale: 'en-CA',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  try {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'media' || type === 'font') {
        void route.abort();
        return;
      }
      void route.continue();
    });

    const resp = await page.goto(url, { waitUntil, timeout: navTimeout });
    const status = resp?.status();
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t.length) {
      const st = typeof status === 'number' ? ` HTTP status ${status}` : '';
      return { text: null, error: `No visible text after navigation${st}` };
    }
    return { text: t };
  } catch (e) {
    return { text: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await context.close().catch(() => {});
  }
}
