/** Same-tab session id changes (localStorage "storage" only fires in other tabs). */
export const SESSION_UPDATED_EVENT = 'nexus-session-updated';

/** Matches server `isSafeIngestId` — session ids are UUIDs. */
export function isValidBrainSessionId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
}

export function notifySessionUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT));
}
