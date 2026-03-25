import dns from 'node:dns/promises';
import net from 'node:net';

/** Split comma-separated host rules: `example.com`, `*.example.com` (prefix form). */
export function parseHostRules(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True if hostname matches at least one rule. Rules: exact host, or `*.parent.tld` suffix match.
 */
/**
 * True when hostname is the seed host or a common paired variant (`example.com` ↔ `www.example.com`).
 * Used only when no explicit host allowlist is configured.
 */
export function hostsAreWwwVariant(hostname: string, seedHostname: string): boolean {
  const h = hostname.toLowerCase();
  const s = seedHostname.toLowerCase();
  if (h === s) return true;
  if (h === `www.${s}`) return true;
  if (s === `www.${h}`) return true;
  return false;
}

export function hostnameMatchesRules(hostname: string, rules: string[]): boolean {
  if (rules.length === 0) return true;
  const h = hostname.toLowerCase();
  for (const rule of rules) {
    if (rule.startsWith('*.')) {
      const rest = rule.slice(2);
      if (h === rest) return true;
      if (h.endsWith('.' + rest)) return true;
    } else if (h === rule) {
      return true;
    }
  }
  return false;
}

export function isPublicIp(ip: string, family: 4 | 6): boolean {
  if (family === 4) {
    const p = ip.split('.').map((x) => Number(x));
    if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
    if (p[0] === 10) return false;
    if (p[0] === 127) return false;
    if (p[0] === 0) return false;
    if (p[0] === 169 && p[1] === 254) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
    if (p[0] >= 224) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1') return false;
  if (lower.startsWith('fe80:')) return false;
  if (/^f[cd][0-9a-f]:/i.test(lower)) return false;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    return isPublicIp(v4, 4);
  }
  return true;
}

export async function assertResolvableHostIsPublic(hostname: string): Promise<void> {
  const literal = net.isIP(hostname);
  if (literal) {
    if (!isPublicIp(hostname, literal === 4 ? 4 : 6)) {
      throw new Error('SSRF: URL host is a non-public IP');
    }
    return;
  }
  const r = await dns.lookup(hostname, { all: false });
  const fam: 4 | 6 = r.family === 6 ? 6 : 4;
  if (!isPublicIp(r.address, fam)) {
    throw new Error('SSRF: hostname resolves to a non-public IP');
  }
}

/**
 * When users paste "https://host/path see also ..." or a whole paragraph, take only the first http(s) URL.
 * Strips common trailing punctuation from sloppy pastes (e.g. closing paren or period).
 */
export function extractHttpUrlFromPaste(raw: string): string {
  const t = raw.trim();
  const m = t.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return t;
  return m[0].replace(/[.,;:!?)]+$/g, '');
}

export function normalizeSeedUrl(raw: string, allowHttp: boolean): URL {
  let s = extractHttpUrlFromPaste(raw);
  if (!s) throw new Error('seedUrl is required');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (u.protocol === 'http:' && !allowHttp) {
    throw new Error('HTTP URLs are disabled; use HTTPS or set WEB_CRAWL_ALLOW_HTTP=1');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  if (!u.hostname) throw new Error('Invalid URL: missing host');
  return u;
}

export function assertHttpUrlProtocol(u: URL): void {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
}
