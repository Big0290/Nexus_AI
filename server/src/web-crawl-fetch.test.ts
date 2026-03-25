import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBounded } from './web-crawl-fetch.js';

describe('fetchBounded', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('runs validateBeforeFetch on redirect targets (SSRF trap)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1/internal' }
        })
      )
      .mockResolvedValue(
        new Response('should-not-reach', {
          status: 200,
          headers: { 'content-type': 'text/plain' }
        })
      );
    globalThis.fetch = f as unknown as typeof fetch;

    await expect(
      fetchBounded('https://public.example/start', {
        timeoutMs: 5000,
        maxBytesPerResponse: 1024,
        headers: {},
        validateBeforeFetch: async (u) => {
          if (u.hostname === '127.0.0.1') throw new Error('SSRF: blocked redirect target');
        }
      })
    ).rejects.toThrow(/SSRF/);

    expect(f).toHaveBeenCalledTimes(1);
  });
});
