<script lang="ts">
  import {
    CrawlRequestError,
    postDocumentTeachTask,
    postTeachCrawl,
    postTeachUpload,
    postWebTeachTask,
    type CrawlDiagnosticsPayload
  } from '../lib/api.js';
  import { summarizeBrainError } from '../lib/brain-errors.js';
  import { notifySessionUpdated } from '../lib/session-events.js';
  import { extractHttpUrlFromPaste } from '../lib/crawl-url.js';

  const SESSION_KEY = 'nexus_brain_session_id';

  let { variant = 'default' } = $props<{
    /** Tighter layout when embedded under the chat composer. */
    variant?: 'default' | 'compact';
  }>();

  let fileInput = $state<HTMLInputElement | null>(null);
  let focusNote = $state('');
  let description = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);
  let crawlDiagnostics = $state<CrawlDiagnosticsPayload | null>(null);
  let lastIngest = $state<{ ingestId: string; maskedTextChars: number } | null>(null);
  let sessionId = $state<string | null>(null);

  let crawlUrl = $state('');
  let crawlMaxPages = $state<number | ''>('');
  let crawlMaxDepth = $state<number | ''>('');
  let crawlAllowedHosts = $state('');
  let crawlAttest = $state(false);
  /** Dev/testing: requires WEB_CRAWL_ALLOW_IGNORE_ROBOTS=1 on the server. */
  let crawlIgnoreRobots = $state(false);

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem(SESSION_KEY);
    if (s) sessionId = s;
  });

  function ensureSessionId(): string {
    if (sessionId?.trim()) return sessionId.trim();
    const id = crypto.randomUUID();
    sessionId = id;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_KEY, id);
    }
    notifySessionUpdated();
    return id;
  }

  async function onUploadAndRun(e: Event) {
    e.preventDefault();
    err = null;
    crawlDiagnostics = null;
    const files = fileInput?.files;
    if (!files?.length) {
      err = 'Choose one or more files (PDF, Excel, CSV, images, text).';
      return;
    }
    busy = true;
    lastIngest = null;
    try {
      const sid = ensureSessionId();
      const up = await postTeachUpload(files, sid);
      sessionId = up.sessionId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_KEY, up.sessionId);
      }
      notifySessionUpdated();
      lastIngest = { ingestId: up.ingestId, maskedTextChars: up.maskedTextChars };
      const r = await postDocumentTeachTask({
        ingestId: up.ingestId,
        description: description.trim() || undefined,
        focusNote: focusNote.trim() || undefined,
        sessionId: up.sessionId
      });
      sessionId = r.sessionId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_KEY, r.sessionId);
      }
      notifySessionUpdated();
      if (fileInput) fileInput.value = '';
    } catch (x) {
      const raw = x instanceof Error ? x.message : String(x);
      const s = summarizeBrainError(raw);
      err = `${s.title}: ${s.hint}`;
    } finally {
      busy = false;
    }
  }

  async function onCrawlAndRun(e: Event) {
    e.preventDefault();
    err = null;
    crawlDiagnostics = null;
    let url = extractHttpUrlFromPaste(crawlUrl);
    if (url !== crawlUrl.trim()) {
      crawlUrl = url;
    }
    if (!url) {
      err = 'Enter a seed URL (HTTPS recommended).';
      return;
    }
    busy = true;
    lastIngest = null;
    try {
      const sid = ensureSessionId();
      const hosts = crawlAllowedHosts
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);
      const cr = await postTeachCrawl({
        seedUrl: url,
        sessionId: sid,
        maxPages: crawlMaxPages === '' ? undefined : Number(crawlMaxPages),
        maxDepth: crawlMaxDepth === '' ? undefined : Number(crawlMaxDepth),
        attestationAccepted: crawlAttest,
        allowedHosts: hosts.length ? hosts : undefined,
        ignoreRobots: crawlIgnoreRobots
      });
      sessionId = cr.sessionId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_KEY, cr.sessionId);
      }
      notifySessionUpdated();
      lastIngest = { ingestId: cr.ingestId, maskedTextChars: cr.maskedTextChars };
      const r = await postWebTeachTask({
        ingestId: cr.ingestId,
        description: description.trim() || undefined,
        focusNote: focusNote.trim() || undefined,
        sessionId: cr.sessionId
      });
      sessionId = r.sessionId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_KEY, r.sessionId);
      }
      notifySessionUpdated();
    } catch (x) {
      if (x instanceof CrawlRequestError) {
        crawlDiagnostics = x.crawlDiagnostics ?? null;
        const s = summarizeBrainError(x.message);
        err = `${s.title}: ${s.hint}`;
      } else {
        crawlDiagnostics = null;
        const raw = x instanceof Error ? x.message : String(x);
        const s = summarizeBrainError(raw);
        err = `${s.title}: ${s.hint}`;
      }
    } finally {
      busy = false;
    }
  }
</script>

<div
  class="teach"
  class:teach--compact={variant === 'compact'}
  aria-busy={busy}
>
  <section class="teach-context" aria-labelledby="teach-context-title">
    <h3 id="teach-context-title" class="teach-section-title">What should the learner focus on?</h3>
    <p class="teach-context-hint">
      These apply to <strong>both</strong> upload and URL crawl. Leave blank to use defaults.
    </p>
    <div class="teach-context-fields">
      <label class="teach-field">
        <span class="teach-label">Task label <span class="teach-optional">(optional)</span></span>
        <input
          type="text"
          bind:value={description}
          placeholder="e.g. Q3 vendor contracts · onboarding policy"
          autocomplete="off"
          disabled={busy}
        />
      </label>
      <label class="teach-field">
        <span class="teach-label">Focus / questions <span class="teach-optional">(optional)</span></span>
        <input
          type="text"
          bind:value={focusNote}
          placeholder="What topics, risks, or questions matter most?"
          autocomplete="off"
          disabled={busy}
        />
      </label>
    </div>
  </section>

  <div class="teach-methods" role="group" aria-label="Choose how to add knowledge">
    <article class="teach-card teach-card--files">
      <header class="teach-card-head">
        <span class="teach-card-icon teach-card-icon--files" aria-hidden="true">1</span>
        <div class="teach-card-head-text">
          <h3 class="teach-card-title">Upload files</h3>
          <p class="teach-card-lede">
            PDFs, spreadsheets, CSV, Markdown, text, or images — extracted and masked on the server, then learned for
            this session.
          </p>
        </div>
      </header>
      <form class="teach-card-form" onsubmit={onUploadAndRun}>
        <label class="teach-field teach-field--file">
          <span class="teach-label">Files</span>
          <span class="teach-file-shell">
            <input
              bind:this={fileInput}
              type="file"
              class="teach-file-input"
              multiple
              accept=".pdf,.csv,.xlsx,.xls,.txt,.md,image/*"
              disabled={busy}
            />
          </span>
        </label>
        <button type="submit" class="teach-btn teach-btn--primary" disabled={busy}>
          {busy ? 'Working…' : 'Upload & learn'}
        </button>
      </form>
    </article>

    <article class="teach-card teach-card--web">
      <header class="teach-card-head">
        <span class="teach-card-icon teach-card-icon--web" aria-hidden="true">2</span>
        <div class="teach-card-head-text">
          <h3 class="teach-card-title">Crawl from a URL</h3>
          <p class="teach-card-lede">
            Start from a page you’re allowed to process. The server respects <code>robots.txt</code>, scopes the crawl,
            and masks text before any model sees it.
          </p>
        </div>
      </header>
      <form class="teach-card-form" onsubmit={onCrawlAndRun}>
        <label class="teach-field">
          <span class="teach-label">Seed URL</span>
          <input
            type="url"
            bind:value={crawlUrl}
            placeholder="https://docs.example.com/guide"
            autocomplete="off"
            disabled={busy}
          />
        </label>

        <details class="teach-advanced">
          <summary class="teach-advanced-summary">Advanced &amp; compliance</summary>
          <div class="teach-advanced-body">
            <p class="teach-legal">
              Use only content you may copy or process (license, site terms, DPIA). Crawling applies rate limits and Law
              25 masking; it does not bypass paywalls or authentication beyond server-configured allowlists.
            </p>
            <div class="teach-advanced-grid">
              <label class="teach-field">
                <span class="teach-label">Max pages <span class="teach-optional">(optional)</span></span>
                <input
                  type="number"
                  min="1"
                  max="500"
                  bind:value={crawlMaxPages}
                  placeholder="Server default"
                  disabled={busy}
                />
              </label>
              <label class="teach-field">
                <span class="teach-label">Max depth <span class="teach-optional">(optional)</span></span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  bind:value={crawlMaxDepth}
                  placeholder="Server default"
                  disabled={busy}
                />
              </label>
            </div>
            <label class="teach-field">
              <span class="teach-label">Allowed hosts <span class="teach-optional">(optional)</span></span>
              <input
                type="text"
                bind:value={crawlAllowedHosts}
                placeholder="docs.example.com, cdn.example.com"
                autocomplete="off"
                disabled={busy}
              />
            </label>
            <label class="teach-check">
              <input type="checkbox" bind:checked={crawlAttest} disabled={busy} />
              <span>
                I am authorized to ingest this origin for this deployment (when attestation is required by the server).
              </span>
            </label>
            <label class="teach-check teach-check--warn">
              <input type="checkbox" bind:checked={crawlIgnoreRobots} disabled={busy} />
              <span>
                <strong>Testing only:</strong> ignore <code>robots.txt</code> (requires server env
                <code class="teach-code-inline">WEB_CRAWL_ALLOW_IGNORE_ROBOTS=1</code>). May violate site policy; remove
                before shipping.
              </span>
            </label>
          </div>
        </details>

        <button type="submit" class="teach-btn teach-btn--secondary" disabled={busy}>
          {busy ? 'Working…' : 'Crawl & learn'}
        </button>
      </form>
    </article>
  </div>

  {#if lastIngest}
    <div class="teach-flash teach-flash--ok" role="status">
      <span class="teach-flash-title">Ingest started</span>
      <span class="teach-flash-detail">
        <code class="teach-code">{lastIngest.ingestId}</code>
        <span aria-hidden="true">·</span>
        {lastIngest.maskedTextChars.toLocaleString()} chars masked
      </span>
    </div>
  {/if}
  {#if err}
    <p class="teach-flash teach-flash--err" role="alert">{err}</p>
  {/if}

  {#if crawlDiagnostics}
    <section class="teach-diagnostics" aria-label="Crawl debug information">
      <details class="teach-diag-details" open>
        <summary class="teach-diag-summary">
          Crawl diagnostics
          {#if crawlDiagnostics.robotsTxtByOrigin && Object.keys(crawlDiagnostics.robotsTxtByOrigin).length > 0}
            <span class="teach-diag-badge">robots.txt</span>
          {/if}
        </summary>
        <div class="teach-diag-body">
          <p class="teach-diag-meta">
            <span class="teach-diag-k">Crawler User-Agent</span>
            <code class="teach-diag-code">{crawlDiagnostics.userAgent}</code>
          </p>
          {#if crawlDiagnostics.lastHtmlFetchError}
            <div class="teach-diag-block">
              <span class="teach-diag-k">Last page fetch error</span>
              <pre class="teach-diag-pre">{crawlDiagnostics.lastHtmlFetchError}</pre>
            </div>
          {/if}
          {#if crawlDiagnostics.pagesTried?.length}
            <div class="teach-diag-block">
              <span class="teach-diag-k">URLs attempted</span>
              <ul class="teach-diag-urls">
                {#each crawlDiagnostics.pagesTried as row (row.url)}
                  <li>
                    <span class="teach-diag-url">{row.url}</span>
                    {#if row.skippedReason}
                      <span class="teach-diag-skip">skipped: {row.skippedReason}</span>
                    {/if}
                    {#if row.statusCode != null}
                      <span class="teach-diag-skip">HTTP {row.statusCode}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          {#each Object.entries(crawlDiagnostics.robotsTxtByOrigin ?? {}) as [origin, snap] (origin)}
            <div class="teach-diag-block teach-diag-block--robots">
              <span class="teach-diag-k">robots.txt for {origin}</span>
              <a class="teach-diag-link" href={snap.robotsUrl} target="_blank" rel="noopener noreferrer"
                >Open in browser</a
              >
              {#if snap.fetchError}
                <p class="teach-diag-warn">Fetch error: {snap.fetchError}</p>
              {:else if snap.httpStatus != null && snap.httpStatus >= 400}
                <p class="teach-diag-warn">HTTP {snap.httpStatus} (treated as empty rules)</p>
              {/if}
              <pre class="teach-diag-pre teach-diag-pre--robots">{snap.body || '(empty — crawler may allow all paths)'}</pre>
            </div>
          {/each}
        </div>
      </details>
    </section>
  {/if}
</div>

<style>
  .teach {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .teach--compact {
    gap: 0.65rem;
  }

  .teach-section-title {
    margin: 0 0 0.35rem;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }

  .teach-context {
    padding: 0.75rem 0.85rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: linear-gradient(
      165deg,
      color-mix(in srgb, var(--accent) 7%, var(--surface)) 0%,
      var(--surface) 55%
    );
    box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 35%, transparent);
  }

  .teach-context-hint {
    margin: 0 0 0.55rem;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .teach-context-hint strong {
    color: var(--text);
    font-weight: 600;
  }

  .teach-context-fields {
    display: grid;
    gap: 0.55rem;
  }

  @media (min-width: 34rem) {
    .teach-context-fields {
      grid-template-columns: 1fr 1fr;
      gap: 0.65rem;
    }
  }

  .teach-methods {
    display: grid;
    gap: 0.75rem;
    align-items: stretch;
  }

  @media (min-width: 52rem) {
    .teach-methods {
      grid-template-columns: 1fr 1fr;
      gap: 0.85rem;
    }
  }

  .teach-card {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem 0.9rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    min-width: 0;
    box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 30%, transparent);
  }

  .teach-card--files {
    border-color: color-mix(in srgb, var(--teal) 28%, var(--border));
  }

  .teach-card--web {
    border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
  }

  .teach-card-head {
    display: flex;
    gap: 0.65rem;
    align-items: flex-start;
  }

  .teach-card-icon {
    flex-shrink: 0;
    width: 2.25rem;
    height: 2.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    font-weight: 750;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .teach-card-icon--files {
    background: var(--teal-soft);
    border: 1px solid color-mix(in srgb, var(--teal) 35%, var(--border));
    color: var(--teal);
  }

  .teach-card-icon--web {
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    color: var(--accent);
  }

  .teach-card-head-text {
    min-width: 0;
  }

  .teach-card-title {
    margin: 0 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .teach-card-lede {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .teach-card-lede code {
    font-size: 0.68rem;
    padding: 0.05rem 0.2rem;
    border-radius: 0.2rem;
    background: var(--bg-subtle);
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    color: var(--text-muted);
  }

  .teach-card-form {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin-top: 0.1rem;
  }

  .teach-field {
    display: grid;
    gap: 0.28rem;
    min-width: 0;
  }

  .teach-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .teach-optional {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-dim);
    opacity: 0.85;
  }

  .teach-field input[type='text'],
  .teach-field input[type='url'] {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--text);
    width: 100%;
    box-sizing: border-box;
  }

  .teach-field input:focus-visible {
    outline: none;
    border-color: color-mix(in srgb, var(--teal) 45%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--teal) 18%, transparent);
  }

  .teach-card--web .teach-field input:focus-visible {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .teach-field input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .teach-field input[type='number'] {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--text);
    width: 100%;
    box-sizing: border-box;
  }

  .teach-field--file {
    gap: 0.4rem;
  }

  .teach-file-shell {
    position: relative;
    display: block;
    min-height: 3.25rem;
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px dashed color-mix(in srgb, var(--teal) 45%, var(--border));
    background: color-mix(in srgb, var(--teal-soft) 55%, var(--bg-subtle));
  }

  .teach-file-input {
    font: inherit;
    font-size: 0.78rem;
    width: 100%;
    color: var(--text-muted);
  }

  .teach-advanced {
    margin: 0;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
    background: color-mix(in srgb, var(--surface-elevated) 40%, var(--bg-subtle));
    overflow: hidden;
  }

  .teach-advanced-summary {
    cursor: pointer;
    list-style: none;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--text-muted);
    padding: 0.45rem 0.55rem;
    user-select: none;
  }

  .teach-advanced-summary::-webkit-details-marker {
    display: none;
  }

  .teach-advanced-summary::after {
    content: '▸';
    float: right;
    opacity: 0.55;
    transition: transform 0.15s ease;
  }

  .teach-advanced[open] .teach-advanced-summary::after {
    transform: rotate(90deg);
  }

  .teach-advanced-summary:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--surface-elevated) 50%, transparent);
  }

  .teach-advanced-body {
    padding: 0 0.55rem 0.55rem;
    display: grid;
    gap: 0.5rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .teach-legal {
    margin: 0.45rem 0 0;
    font-size: 0.68rem;
    line-height: 1.4;
    color: var(--text-dim);
  }

  .teach-advanced-grid {
    display: grid;
    gap: 0.5rem;
  }

  @media (min-width: 22rem) {
    .teach-advanced-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  .teach-check {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--text-muted);
    cursor: pointer;
  }

  .teach-check input {
    margin-top: 0.12rem;
    flex-shrink: 0;
    accent-color: var(--accent);
  }

  .teach-check--warn {
    margin-top: 0.35rem;
    padding: 0.4rem 0.45rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border));
    background: color-mix(in srgb, var(--danger-soft) 40%, transparent);
  }

  .teach-code-inline {
    font-family: ui-monospace, monospace;
    font-size: 0.68em;
    padding: 0.06rem 0.22rem;
    border-radius: 0.2rem;
    background: color-mix(in srgb, var(--surface-elevated) 88%, var(--border));
    word-break: break-all;
  }

  .teach-btn {
    font: inherit;
    font-size: 0.84rem;
    font-weight: 650;
    padding: 0.52rem 1rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    width: 100%;
    border: 1px solid transparent;
    transition: filter 0.12s ease, opacity 0.12s ease;
  }

  .teach-btn:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .teach-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .teach-btn--primary {
    border-color: color-mix(in srgb, var(--teal) 55%, var(--border));
    background: linear-gradient(180deg, color-mix(in srgb, var(--teal) 38%, #14302a) 0%, #1a3d34 100%);
    color: #d4fff0;
  }

  .teach-btn--secondary {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent) 18%, var(--surface-elevated)) 0%,
      var(--surface-elevated) 100%
    );
    color: var(--text);
  }

  .teach-flash {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.4;
    padding: 0.55rem 0.65rem;
    border-radius: var(--radius-sm);
  }

  .teach-flash--ok {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: var(--success);
    background: var(--teal-soft);
    border: 1px solid color-mix(in srgb, var(--teal) 32%, var(--border));
  }

  .teach-flash-title {
    font-weight: 650;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.95;
  }

  .teach-flash-detail {
    font-size: 0.76rem;
    color: var(--text-muted);
  }

  .teach-code {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    word-break: break-all;
    color: var(--text-muted);
  }

  .teach-flash--err {
    color: color-mix(in srgb, var(--danger) 95%, white);
    background: var(--danger-soft);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  }

  .teach-diagnostics {
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--border) 90%, var(--accent));
    background: color-mix(in srgb, var(--surface-elevated) 55%, var(--bg-subtle));
    overflow: hidden;
  }

  .teach-diag-details {
    margin: 0;
  }

  .teach-diag-summary {
    cursor: pointer;
    list-style: none;
    font-size: 0.78rem;
    font-weight: 650;
    color: var(--text-muted);
    padding: 0.55rem 0.65rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    user-select: none;
  }

  .teach-diag-summary::-webkit-details-marker {
    display: none;
  }

  .teach-diag-summary::before {
    content: '▸';
    opacity: 0.55;
    transition: transform 0.15s ease;
  }

  .teach-diag-details[open] .teach-diag-summary::before {
    transform: rotate(90deg);
  }

  .teach-diag-summary:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .teach-diag-badge {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.12rem 0.35rem;
    border-radius: 999px;
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    color: var(--accent);
  }

  .teach-diag-body {
    padding: 0 0.65rem 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    border-top: 1px solid var(--border);
  }

  .teach-diag-meta {
    margin: 0.5rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .teach-diag-k {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }

  .teach-diag-code {
    font-family: ui-monospace, monospace;
    font-size: 0.68rem;
    word-break: break-all;
    color: var(--text-muted);
    padding: 0.35rem 0.45rem;
    border-radius: var(--radius-sm);
    background: var(--bg-subtle);
    border: 1px solid var(--border);
  }

  .teach-diag-block {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .teach-diag-link {
    font-size: 0.72rem;
    color: var(--accent);
    text-decoration: none;
    width: fit-content;
  }

  .teach-diag-link:hover {
    text-decoration: underline;
  }

  .teach-diag-warn {
    margin: 0;
    font-size: 0.72rem;
    color: color-mix(in srgb, var(--amber) 92%, var(--text));
  }

  .teach-diag-urls {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .teach-diag-url {
    word-break: break-all;
    color: var(--text);
  }

  .teach-diag-skip {
    margin-left: 0.35rem;
    font-size: 0.68rem;
    color: var(--text-dim);
  }

  .teach-diag-pre {
    margin: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.65rem;
    line-height: 1.4;
    padding: 0.45rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-muted);
    overflow: auto;
    max-height: 14rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .teach-diag-pre--robots {
    max-height: 18rem;
  }

  /* Compact variant: slightly denser */
  .teach--compact .teach-context {
    padding: 0.55rem 0.65rem;
  }

  .teach--compact .teach-card {
    padding: 0.65rem 0.7rem;
  }

  .teach--compact .teach-card-title {
    font-size: 0.88rem;
  }

  .teach--compact .teach-card-lede {
    font-size: 0.7rem;
  }

  .teach--compact .teach-methods {
    grid-template-columns: 1fr;
  }
</style>
