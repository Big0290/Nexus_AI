/** Same behavior as server `extractHttpUrlFromPaste` — keep in sync. */
export function extractHttpUrlFromPaste(raw: string): string {
  const t = raw.trim();
  const m = t.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return t;
  return m[0].replace(/[.,;:!?)]+$/g, '');
}
