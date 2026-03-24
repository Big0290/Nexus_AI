<script lang="ts">
  import type { SessionTurn } from '../lib/types.js';
  import { fetchSession } from '../lib/api.js';
  import { SESSION_UPDATED_EVENT } from '../lib/session-events.js';

  const SESSION_KEY = 'nexus_brain_session_id';

  /** Messages longer than this show collapsed by default with Show more / Show less. */
  const LONG_MESSAGE_CHARS = 480;

  /** Turn keys the user has expanded (otherwise long messages stay collapsed). */
  let expandedTurnKeys = $state<Record<string, boolean>>({});

  function turnKey(i: number, t: SessionTurn): string {
    return `${i}-${t.role}-${t.timestamp}`;
  }

  function isLongContent(text: string): boolean {
    return text.length > LONG_MESSAGE_CHARS;
  }

  function toggleTurnExpanded(key: string) {
    const open = expandedTurnKeys[key] ?? false;
    expandedTurnKeys = { ...expandedTurnKeys, [key]: !open };
  }

  let {
    refreshKey = 0,
    variant = 'default',
    onReuseUserPrompt
  } = $props<{
    refreshKey?: number;
    /** Fills available height in a chat column and keeps scroll pinned to newest turns. */
    variant?: 'default' | 'chat';
    /** When set, user turns show a control to copy text into the composer. */
    onReuseUserPrompt?: (content: string) => void;
  }>();

  let sessionId = $state<string | null>(null);
  let turns = $state<SessionTurn[]>([]);
  let updatedAt = $state<string | null>(null);
  let ingestHint = $state<string | null>(null);
  let loadErr = $state<string | null>(null);
  let loading = $state(false);
  let timelineEl = $state<HTMLOListElement | null>(null);

  function scrollTranscriptToBottom() {
    const el = timelineEl;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  $effect(() => {
    turns;
    refreshKey;
    queueMicrotask(() => scrollTranscriptToBottom());
  });

  function readLocalSessionId(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const s = localStorage.getItem(SESSION_KEY)?.trim();
    return s || null;
  }

  async function load() {
    loadErr = null;
    sessionId = readLocalSessionId();
    if (!sessionId) {
      turns = [];
      updatedAt = null;
      ingestHint = null;
      return;
    }
    loading = true;
    try {
      const j = (await fetchSession(sessionId)) as {
        session?: {
          id?: string;
          updatedAt?: string;
          turns?: unknown;
          documentIngestId?: string;
        };
      };
      const s = j.session;
      if (!s?.turns || !Array.isArray(s.turns)) {
        turns = [];
        updatedAt = s?.updatedAt ?? null;
        ingestHint = null;
        return;
      }
      turns = s.turns.filter(
        (t): t is SessionTurn =>
          t != null &&
          typeof t === 'object' &&
          (t as SessionTurn).role !== undefined &&
          typeof (t as SessionTurn).content === 'string'
      );
      updatedAt = typeof s.updatedAt === 'string' ? s.updatedAt : null;
      ingestHint = typeof s.documentIngestId === 'string' ? s.documentIngestId : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      loadErr = msg.includes('404') || msg.includes('not found') ? 'No saved thread for this session id yet.' : msg;
      turns = [];
      updatedAt = null;
      ingestHint = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    refreshKey;
    void load();
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === SESSION_KEY) void load();
    };
    const onSessionBump = () => void load();
    window.addEventListener('storage', onStorage);
    window.addEventListener(SESSION_UPDATED_EVENT, onSessionBump);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SESSION_UPDATED_EVENT, onSessionBump);
    };
  });

  function timeShort(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
</script>

<section
  class="hist"
  class:hist--chat={variant === 'chat'}
  aria-labelledby={variant === 'chat' ? 'hist-heading-chat' : 'hist-heading'}
>
  <header class="hist-head">
    <div class="hist-titles">
      {#if variant === 'chat'}
        <h2 id="hist-heading-chat" class="hist-title hist-title--chat">Conversation</h2>
        <p class="hist-sub hist-sub--chat">Turns for this browser session (server-side thread).</p>
      {:else}
        <h2 id="hist-heading" class="hist-title">Prompt history</h2>
        <p class="hist-sub">
          Your prompts and Brain replies for this browser session (stored on the server under
          <code>DATA_DIR/sessions</code>).
        </p>
      {/if}
    </div>
    <button type="button" class="hist-refresh" disabled={loading} onclick={() => void load()}>
      {loading ? 'Loading…' : 'Refresh'}
    </button>
  </header>

  <div class="hist-main" class:hist-main--chat={variant === 'chat'}>
    {#if !sessionId}
      <p class="hist-empty">
        Run a task or teach from documents once — a session id will appear and history will load here.
      </p>
    {:else}
      <p class="hist-meta">
        <span class="mono" title={sessionId}>Session <code>{sessionId.slice(0, 8)}…</code></span>
        {#if updatedAt}
          <span class="dim">· updated {timeShort(updatedAt)}</span>
        {/if}
        {#if ingestHint}
          <span class="dim">· teach ingest <code class="ing">{ingestHint.slice(0, 8)}…</code></span>
        {/if}
      </p>
    {/if}

    {#if loadErr}
      <p class="hist-err" role="alert">{loadErr}</p>
    {/if}

    {#if sessionId && !loadErr && turns.length === 0 && !loading}
      <p class="hist-empty">
        No turns in this session yet — send a message or use <strong>Teach</strong> in the tool bar below.
      </p>
    {/if}

    {#if turns.length > 0}
      <ol class="timeline" class:timeline--chat={variant === 'chat'} bind:this={timelineEl}>
        {#each turns as t, i (`${i}-${t.role}-${t.timestamp}`)}
          {@const tk = turnKey(i, t)}
          {@const long = isLongContent(t.content)}
          {@const expanded = expandedTurnKeys[tk] ?? false}
          <li class="turn" class:user={t.role === 'user'} class:assistant={t.role === 'assistant'}>
            <div class="turn-head">
              <span class="role">{t.role === 'user' ? 'You' : 'Brain'}</span>
              <div class="turn-head-actions">
                {#if t.role === 'user' && onReuseUserPrompt}
                  <button
                    type="button"
                    class="turn-reuse"
                    onclick={() => onReuseUserPrompt(t.content)}
                  >
                    Refill
                  </button>
                {/if}
                <time class="when" datetime={t.timestamp}>{timeShort(t.timestamp)}</time>
              </div>
            </div>
            <div class="bubble">
              <pre
                class="content"
                class:content--long-collapsed={long && !expanded}
                class:content--long-expanded={long && expanded}
              >{t.content}</pre>
              {#if long}
                <div class="bubble-expand-row">
                  <button
                    type="button"
                    class="expand-btn"
                    aria-expanded={expanded}
                    onclick={() => toggleTurnExpanded(tk)}
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
      {#if variant !== 'chat'}
        <p class="hist-foot">Showing {turns.length} turn{turns.length === 1 ? '' : 's'} (oldest at top).</p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .hist {
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 0.75rem 0.85rem 0.85rem;
    display: grid;
    gap: 0.55rem;
  }

  .hist--chat {
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 0.5rem 0.65rem 0.65rem;
    gap: 0.45rem;
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .hist-main {
    display: contents;
  }

  .hist-main--chat {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: 0.45rem;
  }

  .hist-title--chat {
    font-size: 0.82rem;
    margin-bottom: 0.15rem;
  }

  .hist-sub--chat {
    font-size: 0.68rem;
  }

  .hist-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 1rem;
  }

  .hist-titles {
    min-width: 0;
  }

  .hist-title {
    margin: 0 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 650;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .hist-sub {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--text-dim);
    max-width: 40rem;
  }

  .hist-sub code {
    font-size: 0.65rem;
  }

  .hist-refresh {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .hist-refresh:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .hist-refresh:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .hist-meta {
    margin: 0;
    font-size: 0.72rem;
    color: var(--text-muted);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .mono code,
  code.ing {
    font-size: 0.68rem;
    word-break: break-all;
  }

  .dim {
    color: var(--text-dim);
  }

  .hist-empty,
  .hist-err {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .hist-empty {
    color: var(--text-dim);
    padding: 0.35rem 0;
  }

  .hist-err {
    color: color-mix(in srgb, var(--danger) 88%, white);
  }

  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    max-height: min(55vh, 28rem);
    overflow-y: auto;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    padding: 0.55rem 0.6rem;
  }

  .timeline--chat {
    max-height: none;
    flex: 1;
    min-height: 0;
  }

  .turn {
    display: grid;
    gap: 0.3rem;
  }

  .turn-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
  }

  .turn-head-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
  }

  .turn-reuse {
    font: inherit;
    font-size: 0.62rem;
    font-weight: 600;
    padding: 0.12rem 0.45rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border));
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    color: var(--accent);
    cursor: pointer;
  }

  .turn-reuse:hover {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    color: color-mix(in srgb, var(--accent) 92%, white);
  }

  .role {
    font-size: 0.68rem;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .turn.user .role {
    color: var(--accent);
  }

  .turn.assistant .role {
    color: var(--teal);
  }

  .when {
    font-size: 0.65rem;
    color: var(--text-dim);
  }

  .bubble {
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    overflow: hidden;
  }

  .turn.user .bubble {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
    background: color-mix(in srgb, var(--accent) 6%, var(--surface-elevated));
  }

  .turn.assistant .bubble {
    border-color: color-mix(in srgb, var(--teal) 25%, var(--border));
    background: color-mix(in srgb, var(--teal) 5%, var(--surface-elevated));
  }

  .bubble-expand-row {
    padding: 0 0.5rem 0.4rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    background: color-mix(in srgb, var(--bg-subtle) 40%, transparent);
  }

  .expand-btn {
    font: inherit;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.2rem 0;
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 0.12em;
  }

  .expand-btn:hover {
    color: color-mix(in srgb, var(--accent) 88%, white);
  }

  .content {
    margin: 0;
    padding: 0.45rem 0.55rem;
    font-size: 0.78rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-sans-serif, system-ui, sans-serif;
    color: var(--text);
  }

  .content--long-collapsed {
    max-height: 7.25rem;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, black calc(100% - 1.1rem), transparent 100%);
  }

  .content--long-expanded {
    max-height: min(50vh, 24rem);
    overflow: auto;
  }

  .hist-foot {
    margin: 0;
    font-size: 0.68rem;
    color: var(--text-dim);
  }
</style>
