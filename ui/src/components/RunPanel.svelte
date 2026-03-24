<script lang="ts">
  import type { InterpretationResult, InterventionRequest, TaskRunResult } from '../lib/types.js';
  import TaskForm from './TaskForm.svelte';
  import DocumentTeachPanel from './DocumentTeachPanel.svelte';
  import LastRunResult from './LastRunResult.svelte';
  import LastIntakeSnapshot from './LastIntakeSnapshot.svelte';
  import PromptHistoryPanel from './PromptHistoryPanel.svelte';
  import InterventionQueue from './InterventionQueue.svelte';
  import { fetchSession } from '../lib/api.js';
  import {
    isValidBrainSessionId,
    notifySessionUpdated,
    SESSION_UPDATED_EVENT
  } from '../lib/session-events.js';

  type LastRunSnapshot = TaskRunResult & { receivedAt: string };

  const SESSION_KEY = 'nexus_brain_session_id';

  let {
    lastTaskResult = null,
    onClearLastResult,
    onGoKnowledge,
    onGoReview,
    lastInterpretation = null,
    processing = false,
    sessionHistoryRefresh = 0,
    pendingInterventions = [] as InterventionRequest[],
    openDetail = (_title: string, _body: string, _meta?: string | null) => {},
    afterHitlAction = async () => {}
  } = $props<{
    lastTaskResult?: LastRunSnapshot | null;
    onClearLastResult?: () => void;
    onGoKnowledge?: () => void;
    onGoReview?: () => void;
    lastInterpretation?: InterpretationResult | null;
    processing?: boolean;
    sessionHistoryRefresh?: number;
    pendingInterventions?: InterventionRequest[];
    openDetail?: (title: string, body: string, meta?: string | null) => void;
    afterHitlAction?: () => void | Promise<void>;
  }>();

  let runSection = $state<'chat' | 'teach' | 'prompt'>('chat');

  /** Bumps when the browser session id in localStorage may have changed. */
  let sessionHintKey = $state(0);

  let resumeInput = $state('');
  let resumeBusy = $state(false);
  let resumeErr = $state<string | null>(null);

  let reuseTap = $state(0);
  let reuseContent = $state('');

  const hitlCount = $derived(pendingInterventions.length);

  function reuseUserPrompt(content: string) {
    resumeErr = null;
    runSection = 'chat';
    reuseContent = content;
    reuseTap += 1;
  }

  async function resumeThread() {
    resumeErr = null;
    const raw = resumeInput.trim();
    if (!raw) {
      resumeErr = 'Paste a session UUID to resume that thread.';
      return;
    }
    if (!isValidBrainSessionId(raw)) {
      resumeErr = 'Invalid id — expected a full UUID (8-4-4-4-12 hex).';
      return;
    }
    resumeBusy = true;
    try {
      await fetchSession(raw);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_KEY, raw);
      }
      sessionHintKey += 1;
      notifySessionUpdated();
      resumeInput = '';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resumeErr =
        msg.includes('404') || msg.toLowerCase().includes('not found')
          ? 'No saved session on the server for that id.'
          : msg;
    } finally {
      resumeBusy = false;
    }
  }

  async function copySessionId() {
    const id = sessionHint?.trim();
    if (!id || typeof navigator?.clipboard?.writeText !== 'function') return;
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      /* ignore */
    }
  }

  function readSessionHint(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const s = localStorage.getItem(SESSION_KEY)?.trim();
    return s || null;
  }

  let sessionHint = $derived.by(() => {
    sessionHintKey;
    sessionHistoryRefresh;
    return readSessionHint();
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const bump = () => {
      sessionHintKey += 1;
    };
    window.addEventListener(SESSION_UPDATED_EVENT, bump);
    return () => window.removeEventListener(SESSION_UPDATED_EVENT, bump);
  });

  function newSession() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
    sessionHintKey += 1;
    notifySessionUpdated();
  }
</script>

<div class="run-panel">
  <div class="app-tabstrip" role="tablist" aria-label="Run workspace">
    <button
      type="button"
      id="run-tab-chat"
      class="app-tabstrip-btn"
      role="tab"
      aria-selected={runSection === 'chat'}
      class:app-tabstrip-btn--active={runSection === 'chat'}
      class:app-tabstrip-btn--hitl={hitlCount > 0}
      onclick={() => (runSection = 'chat')}
    >
      Chat
      {#if hitlCount > 0}
        <span class="app-tabstrip-badge" aria-hidden="true">{hitlCount}</span>
      {/if}
    </button>
    <button
      type="button"
      id="run-tab-teach"
      class="app-tabstrip-btn"
      role="tab"
      aria-selected={runSection === 'teach'}
      class:app-tabstrip-btn--active={runSection === 'teach'}
      onclick={() => (runSection = 'teach')}
    >
      Teach
    </button>
    <button
      type="button"
      id="run-tab-prompt"
      class="app-tabstrip-btn"
      role="tab"
      aria-selected={runSection === 'prompt'}
      class:app-tabstrip-btn--active={runSection === 'prompt'}
      onclick={() => (runSection = 'prompt')}
    >
      Prompt
    </button>
  </div>

  {#if runSection === 'chat'}
    <div class="run-tab-panel" role="tabpanel" id="run-panel-chat" aria-labelledby="run-tab-chat">
      {#if pendingInterventions.length > 0}
        <InterventionQueue
          variant="embedded"
          items={pendingInterventions}
          {openDetail}
          {afterHitlAction}
        />
      {/if}

      <div class="run-chat-shell">
        <header class="run-chat-head">
          <div class="run-chat-intro">
            <h2 class="run-chat-title">Conversation</h2>
            <p class="run-chat-lede">
              Thread with the Brain for this browser session. <strong>Refill</strong> a past user message to edit and
              resend. Pending human review appears above when the Brain pauses.
            </p>
          </div>

          <div class="run-chat-toolbar" role="toolbar" aria-label="Session tools">
            <div class="run-tool-meta">
              {#if sessionHint}
                <span class="run-sess" title={sessionHint}>Session {sessionHint.slice(0, 8)}…</span>
                <button
                  type="button"
                  class="run-tool-ghost"
                  title="Copy full session id"
                  onclick={() => void copySessionId()}
                >
                  Copy ID
                </button>
              {:else}
                <span class="run-sess dim">No session yet</span>
              {/if}
              <button type="button" class="run-tool-ghost" onclick={newSession}>New session</button>
            </div>

            <div class="run-tool-links">
              {#if onGoKnowledge}
                <button type="button" class="run-tool-ghost" onclick={onGoKnowledge}>Knowledge</button>
              {/if}
              {#if onGoReview}
                <button type="button" class="run-tool-ghost" onclick={onGoReview}>Human review</button>
              {/if}
            </div>
          </div>

          <div class="run-resume">
            <label class="run-resume-label">
              <span class="run-resume-hint">Resume thread</span>
              <input
                type="text"
                class="run-resume-input"
                bind:value={resumeInput}
                placeholder="Paste full session UUID…"
                autocomplete="off"
                spellcheck="false"
                onkeydown={(e) => e.key === 'Enter' && void resumeThread()}
              />
            </label>
            <button type="button" class="run-tool-ghost" disabled={resumeBusy} onclick={() => void resumeThread()}>
              {resumeBusy ? 'Checking…' : 'Resume'}
            </button>
          </div>
          {#if resumeErr}
            <p class="run-resume-err" role="alert">{resumeErr}</p>
          {/if}
        </header>

        <div class="run-chat-body">
          <PromptHistoryPanel
            refreshKey={sessionHistoryRefresh}
            variant="chat"
            onReuseUserPrompt={reuseUserPrompt}
          />
        </div>

        <div class="run-chat-composer" aria-label="Message composer">
          <TaskForm variant="chat" reuseTap={reuseTap} reuseContent={reuseContent} />
        </div>
      </div>
    </div>
  {:else if runSection === 'teach'}
    <div class="run-tab-panel run-tab-panel--padded" role="tabpanel" id="run-panel-teach" aria-labelledby="run-tab-teach">
      <div class="run-tab-intro">
        <h2 class="run-tab-title">Teach from documents</h2>
        <p class="run-tab-lede">
          Upload files — content is Law 25–masked on the server, then learned into memory for your session.
        </p>
      </div>
      <DocumentTeachPanel />
    </div>
  {:else}
    <div class="run-tab-panel run-tab-panel--padded" role="tabpanel" id="run-panel-prompt" aria-labelledby="run-tab-prompt">
      <div class="run-tab-intro">
        <h2 class="run-tab-title">Prompt &amp; run output</h2>
        <p class="run-tab-lede">
          Latest specialist result, intake interpretation, and human-review shortcuts. Conversation lives under
          <strong>Chat</strong>.
        </p>
      </div>

      <LastRunResult
        result={lastTaskResult ?? null}
        onClear={onClearLastResult}
        onGoKnowledge={onGoKnowledge}
        onGoReview={onGoReview}
      />

      {#if lastTaskResult == null}
        <p class="result-placeholder">
          When a run completes, the <strong>full specialist output</strong> appears here — with copy, JSON when
          applicable, and a link to the saved outcome in Knowledge.
        </p>
      {/if}

      <LastIntakeSnapshot
        interpretation={lastInterpretation}
        {processing}
        onGoHumanReview={onGoReview}
      />
    </div>
  {/if}
</div>

<style>
  .run-panel {
    display: grid;
    gap: 0.65rem;
  }

  .run-tab-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
  }

  .run-tab-panel--padded {
    display: grid;
    gap: 0.75rem;
  }

  .run-tab-intro {
    padding: 0.15rem 0 0.1rem;
  }

  .run-tab-title {
    margin: 0 0 0.3rem;
    font-size: 1rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .run-tab-lede {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-muted);
    max-width: 48rem;
  }

  .run-tab-lede strong {
    color: var(--text);
    font-weight: 600;
  }

  .result-placeholder {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--text-dim);
    padding: 0.5rem 0.65rem;
    border-radius: var(--radius);
    border: 1px dashed color-mix(in srgb, var(--border) 85%, transparent);
    background: color-mix(in srgb, var(--surface) 92%, var(--bg));
  }

  .result-placeholder strong {
    color: var(--text-muted);
    font-weight: 600;
  }

  .run-chat-shell {
    display: flex;
    flex-direction: column;
    min-height: min(64vh, 34rem);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 0;
    overflow: hidden;
    box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 40%, transparent);
  }

  .run-chat-head {
    flex-shrink: 0;
    padding: 0.65rem 0.85rem 0.55rem;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent) 6%, var(--surface)) 0%,
      var(--surface) 100%
    );
    display: grid;
    gap: 0.55rem;
  }

  .run-chat-intro {
    min-width: 0;
  }

  .run-chat-title {
    margin: 0 0 0.25rem;
    font-size: 1.02rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .run-chat-lede {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-muted);
    max-width: 48rem;
  }

  .run-chat-lede strong {
    color: var(--text);
    font-weight: 600;
  }

  .run-resume {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.45rem;
    padding-top: 0.1rem;
  }

  .run-resume-label {
    display: grid;
    gap: 0.2rem;
    flex: 1 1 14rem;
    min-width: 0;
  }

  .run-resume-hint {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .run-resume-input {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--text);
    width: 100%;
    box-sizing: border-box;
  }

  .run-resume-input:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }

  .run-resume-err {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.4;
    color: color-mix(in srgb, var(--danger) 90%, white);
  }

  .run-chat-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .run-tool-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .run-sess {
    font-family: ui-monospace, monospace;
    word-break: break-all;
  }

  .run-sess.dim {
    color: var(--text-dim);
  }

  .run-tool-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-left: auto;
  }

  .run-tool-ghost {
    font: inherit;
    font-size: 0.72rem;
    padding: 0.25rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    color: var(--text-muted);
    cursor: pointer;
  }

  .run-tool-ghost:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .run-chat-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg-subtle) 88%, var(--surface));
  }

  .run-chat-composer {
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    padding: 0.65rem 0.85rem 0.75rem;
    background: var(--surface);
    display: grid;
    gap: 0.45rem;
  }
</style>
