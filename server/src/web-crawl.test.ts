import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { extractLocsFromSitemapXml, looksLikeSitemapIndex } from './web-crawl-sitemap.js';
import {
  hostnameMatchesRules,
  hostsAreWwwVariant,
  isPublicIp,
  normalizeSeedUrl,
  parseHostRules
} from './web-crawl-ssrf.js';

const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as (url: string, body: string) => {
  isAllowed(url: string, ua?: string): boolean;
};

describe('web-crawl-ssrf', () => {
  it('detects private IPv4', () => {
    expect(isPublicIp('8.8.8.8', 4)).toBe(true);
    expect(isPublicIp('127.0.0.1', 4)).toBe(false);
    expect(isPublicIp('10.0.0.1', 4)).toBe(false);
    expect(isPublicIp('192.168.1.1', 4)).toBe(false);
  });

  it('matches host rules including wildcards', () => {
    const rules = parseHostRules('example.com, *.cdn.example.com');
    expect(hostnameMatchesRules('example.com', rules)).toBe(true);
    expect(hostnameMatchesRules('x.cdn.example.com', rules)).toBe(true);
    expect(hostnameMatchesRules('evil.com', rules)).toBe(false);
  });

  it('normalizes bare host to https when http allowed', () => {
    const u = normalizeSeedUrl('example.com/docs', true);
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('example.com');
  });

  it('extracts first URL when a whole sentence was pasted', () => {
    const u = normalizeSeedUrl(
      'https://www.canadapost-postescanada.ca/scp/fr/accueil.page in Chrome/Safari. If it loads',
      true
    );
    expect(u.href).toBe('https://www.canadapost-postescanada.ca/scp/fr/accueil.page');
  });

  it('treats www and apex as the same site for default scope', () => {
    expect(hostsAreWwwVariant('www.example.com', 'example.com')).toBe(true);
    expect(hostsAreWwwVariant('example.com', 'www.example.com')).toBe(true);
    expect(hostsAreWwwVariant('example.com', 'example.com')).toBe(true);
    expect(hostsAreWwwVariant('cdn.example.com', 'example.com')).toBe(false);
  });
});

describe('web-crawl-sitemap', () => {
  it('extracts loc tags', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc> https://a.com/p1 </loc></url>
      <url><loc>https://a.com/p2</loc></url>
    </urlset>`;
    expect(extractLocsFromSitemapXml(xml)).toEqual(['https://a.com/p1', 'https://a.com/p2']);
  });

  it('detects sitemap index', () => {
    expect(looksLikeSitemapIndex('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(looksLikeSitemapIndex('<urlset>')).toBe(false);
  });
});

describe('robots.txt (library)', () => {
  it('disallows paths for HTML and PDF under same rule', () => {
    const r = robotsParser('https://corp.example/robots.txt', 'User-agent: *\nDisallow: /private/\n');
    const ua = 'NexusBrainTeach/1.0';
    expect(r.isAllowed('https://corp.example/', ua)).toBe(true);
    expect(r.isAllowed('https://corp.example/public/guide.pdf', ua)).toBe(true);
    expect(r.isAllowed('https://corp.example/private/guide.pdf', ua)).toBe(false);
    expect(r.isAllowed('https://corp.example/private/page', ua)).toBe(false);
  });
});
