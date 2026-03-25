import type { CrawlJobAudit } from './document-ingest.js';

/** Snapshot of robots.txt as fetched for one origin (for operator debugging). */
export type RobotsTxtSnapshot = {
  robotsUrl: string;
  body: string;
  fetchError?: string;
  httpStatus?: number;
};

export type WebCrawlDiagnostics = {
  seedUrl: string;
  userAgent: string;
  pagesTried: Array<{
    url: string;
    depth: number;
    skippedReason?: string;
    statusCode?: number;
  }>;
  crawlJob: CrawlJobAudit;
  /** Keyed by origin (e.g. https://example.com) */
  robotsTxtByOrigin: Record<string, RobotsTxtSnapshot>;
  /** Last error when the HTML page GET threw (TLS, timeout, etc.) */
  lastHtmlFetchError?: string;
};

export class WebCrawlIngestError extends Error {
  readonly diagnostics: WebCrawlDiagnostics;

  constructor(message: string, diagnostics: WebCrawlDiagnostics) {
    super(message);
    this.name = 'WebCrawlIngestError';
    this.diagnostics = diagnostics;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
