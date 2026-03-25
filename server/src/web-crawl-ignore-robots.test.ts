import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Law25Auditor } from '@nexus/brain-core';
import { ingestWebCrawl } from './web-crawl-ingest.js';
import { WebCrawlIngestError } from './web-crawl-error.js';

describe('ingestWebCrawl ignoreRobots (local http)', () => {
  const envBackup: Record<string, string | undefined> = {};
  let baseUrl = '';
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    for (const k of [
      'WEB_CRAWL_ALLOW_PRIVATE_HOSTS',
      'WEB_CRAWL_ALLOW_HTTP',
      'WEB_CRAWL_DELAY_MS',
      'WEB_CRAWL_MAX_PAGES',
      'WEB_CRAWL_MAX_DEPTH',
      'WEB_CRAWL_USE_SITEMAP',
      'WEB_CRAWL_HEADLESS',
      'WEB_CRAWL_ALLOW_IGNORE_ROBOTS'
    ]) {
      envBackup[k] = process.env[k];
    }
    process.env.WEB_CRAWL_ALLOW_PRIVATE_HOSTS = '1';
    process.env.WEB_CRAWL_ALLOW_HTTP = '1';
    process.env.WEB_CRAWL_DELAY_MS = '0';
    process.env.WEB_CRAWL_MAX_PAGES = '3';
    process.env.WEB_CRAWL_MAX_DEPTH = '0';
    process.env.WEB_CRAWL_USE_SITEMAP = '0';
    process.env.WEB_CRAWL_HEADLESS = '0';

    server = createServer((req, res) => {
      const u = req.url?.split('?')[0] ?? '/';
      if (u === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /\n');
        return;
      }
      if (u === '/' || u === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!DOCTYPE html><html><head><title>RobotsDeny</title></head><body><p>IGNORE_ROBOTS_MARKER</p></body></html>'
        );
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
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const k of Object.keys(envBackup)) {
      const v = envBackup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('does not fetch HTML when robots disallows everything', async () => {
    delete process.env.WEB_CRAWL_ALLOW_IGNORE_ROBOTS;
    const dataDir = await mkdtemp(join(tmpdir(), 'nexus-crawl-robots-'));
    try {
      const auditor = new Law25Auditor();
      await expect(
        ingestWebCrawl({
          dataDir,
          auditor,
          seedUrl: baseUrl,
          visionOnIngest: false
        })
      ).rejects.toThrow(WebCrawlIngestError);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('fetches HTML when ignoreRobots is true and WEB_CRAWL_ALLOW_IGNORE_ROBOTS=1', async () => {
    process.env.WEB_CRAWL_ALLOW_IGNORE_ROBOTS = '1';
    const dataDir = await mkdtemp(join(tmpdir(), 'nexus-crawl-robots-ignore-'));
    try {
      const auditor = new Law25Auditor();
      const result = await ingestWebCrawl({
        dataDir,
        auditor,
        seedUrl: baseUrl,
        visionOnIngest: false,
        ignoreRobots: true
      });
      expect(result.manifest.crawlJob?.ignoreRobotsApplied).toBe(true);
      expect(result.maskedCombinedText).toContain('IGNORE_ROBOTS_MARKER');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
