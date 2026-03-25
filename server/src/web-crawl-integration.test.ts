import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Law25Auditor } from '@nexus/brain-core';
import { ingestWebCrawl } from './web-crawl-ingest.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturePdf = join(__dirname, 'fixtures', 'sample.pdf');

describe('ingestWebCrawl (integration, local http)', () => {
  const envBackup: Record<string, string | undefined> = {};
  let baseUrl = '';
  let server: ReturnType<typeof createServer>;
  let dataDir = '';
  let pdf: Buffer = Buffer.alloc(0);

  beforeAll(async () => {
    pdf = await readFile(fixturePdf);
    if (pdf.length === 0) throw new Error('missing fixture src/fixtures/sample.pdf');

    for (const k of [
      'WEB_CRAWL_ALLOW_PRIVATE_HOSTS',
      'WEB_CRAWL_ALLOW_HTTP',
      'WEB_CRAWL_DELAY_MS',
      'WEB_CRAWL_MAX_PAGES',
      'WEB_CRAWL_MAX_DEPTH',
      'WEB_CRAWL_USE_SITEMAP',
      'WEB_CRAWL_HEADLESS'
    ]) {
      envBackup[k] = process.env[k];
    }
    process.env.WEB_CRAWL_ALLOW_PRIVATE_HOSTS = '1';
    process.env.WEB_CRAWL_ALLOW_HTTP = '1';
    process.env.WEB_CRAWL_DELAY_MS = '0';
    process.env.WEB_CRAWL_MAX_PAGES = '5';
    process.env.WEB_CRAWL_MAX_DEPTH = '2';
    process.env.WEB_CRAWL_USE_SITEMAP = '0';
    process.env.WEB_CRAWL_HEADLESS = '0';

    server = createServer((req, res) => {
      const u = req.url?.split('?')[0] ?? '/';
      if (u === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nDisallow:\n');
        return;
      }
      if (u === '/' || u === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><title>IntegrationCrawlTitle</title></head>
<body>
<p>HTML_INTEGRATION_MARKER_PAGE</p>
<p><a href="/sample.pdf">Sample PDF</a></p>
</body></html>`);
        return;
      }
      if (u === '/sample.pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(pdf);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const port: number = await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const a = server.address();
        if (a && typeof a === 'object') resolve(a.port);
        else reject(new Error('no port'));
      });
      server.on('error', reject);
    });

    baseUrl = `http://127.0.0.1:${port}/`;
    dataDir = await mkdtemp(join(tmpdir(), 'nexus-crawl-int-'));
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const k of Object.keys(envBackup)) {
      const v = envBackup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it(
    'merges HTML page and linked PDF into masked ingest output',
    async () => {
      const auditor = new Law25Auditor();
      const result = await ingestWebCrawl({
        dataDir,
        auditor,
        seedUrl: baseUrl,
        visionOnIngest: false
      });

      expect(result.manifest.source).toBe('web_crawl');
      expect(result.manifest.seedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(result.maskedCombinedText).toContain('HTML_INTEGRATION_MARKER_PAGE');
      expect(result.maskedCombinedText).toContain('IntegrationCrawlTitle');
      expect(result.maskedCombinedText.toLowerCase()).toContain('sample pdf');
      expect(result.manifest.crawlJob?.assetsFetched).toBeGreaterThanOrEqual(1);
      const pdfFile = result.manifest.files.find((f) => f.name.includes('sample.pdf'));
      expect(pdfFile?.mime).toMatch(/pdf/i);
    },
    60_000
  );
});
