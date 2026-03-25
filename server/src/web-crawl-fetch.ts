export interface BoundedFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  buffer: Buffer;
  truncated: boolean;
}

function mergeHeaders(base: Record<string, string>, extra?: Record<string, string>): Record<string, string> {
  return { ...base, ...extra };
}

async function readBodyWithLimit(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let remaining = maxBytes;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    if (value.length <= remaining) {
      chunks.push(Buffer.from(value));
      remaining -= value.length;
      if (remaining <= 0) break;
    } else {
      chunks.push(Buffer.from(value.slice(0, remaining)));
      remaining = 0;
      break;
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}

/**
 * Fetch with manual redirect handling, per-response byte cap, and timeout.
 * Pass `validateBeforeFetch` to run SSRF / policy checks on every URL (including redirect targets).
 */
export async function fetchBounded(
  startUrl: string,
  opts: {
    timeoutMs: number;
    maxBytesPerResponse: number;
    headers: Record<string, string>;
    maxRedirects?: number;
    /** Invoked before each HTTP request (initial URL and each redirect target). */
    validateBeforeFetch?: (url: URL) => void | Promise<void>;
  }
): Promise<BoundedFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 8;
  let current = startUrl;
  const baseHeaders = mergeHeaders(
    {
      Accept: '*/*',
      'Accept-Encoding': 'identity'
    },
    opts.headers
  );

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let requestUrl: URL;
    try {
      requestUrl = new URL(current);
    } catch {
      throw new Error('Invalid URL in redirect chain');
    }
    if (opts.validateBeforeFetch) {
      await opts.validateBeforeFetch(requestUrl);
    }

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: baseHeaders
      });
    } finally {
      clearTimeout(t);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        return {
          finalUrl: current,
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          buffer: Buffer.alloc(0),
          truncated: false
        };
      }
      current = new URL(loc, current).href;
      continue;
    }

    const ct = res.headers.get('content-type') ?? '';
    const buf = await readBodyWithLimit(res.body, opts.maxBytesPerResponse);
    const cl = res.headers.get('content-length');
    const truncated = Boolean(cl && Number(cl) > opts.maxBytesPerResponse) || buf.length >= opts.maxBytesPerResponse;
    return {
      finalUrl: current,
      status: res.status,
      contentType: ct,
      buffer: buf,
      truncated
    };
  }

  throw new Error(`Too many redirects (>${maxRedirects})`);
}

export function contentTypeBase(ct: string): string {
  return ct.split(';')[0].trim().toLowerCase();
}
