<script lang="ts">
  import type { InterpretationResult, OrchestratorState } from '../lib/types.js';
  import { fetchHealth, fetchSession } from '../lib/api.js';

  const SESSION_KEY = 'nexus_brain_session_id';

  let { orchestrator }: { orchestrator: OrchestratorState } = $props();

  let health = $state<Record<string, unknown> | null>(null);
  let healthErr = $state<string | null>(null);
  let sessionJson = $state<string | null>(null);
  let sessionErr = $state<string | null>(null);
  let apiKeyInput = $state('');
  let loadBusy = $state(false);

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    apiKeyInput = localStorage.getItem('nexus_api_key') ?? '';
  });

  async function refreshHealth() {
    healthErr = null;
    try {
      health = (await fetchHealth()) as Record<string, unknown>;
    } catch (e) {
      healthErr = e instanceof Error ? e.message : String(e);
      health = null;
    }
  }

  async function saveApiKey() {
    const v = apiKeyInput.trim();
    if (typeof localStorage !== 'undefined') {
      if (v) localStorage.setItem('nexus_api_key', v);
      else localStorage.removeItem('nexus_api_key');
    }
    await refreshHealth();
  }

  async function loadPersistedSession() {
    sessionErr = null;
    sessionJson = null;
    if (typeof localStorage === 'undefined') return;
    const id = localStorage.getItem(SESSION_KEY);
    if (!id?.trim()) {
      sessionErr = 'No session id in localStorage yet — run a task from the Run tab first.';
      return;
    }
    loadBusy = true;
    try {
      const j = await fetchSession(id.trim());
      sessionJson = JSON.stringify(j.session, null, 2);
    } catch (e) {
      sessionErr = e instanceof Error ? e.message : String(e);
    } finally {
      loadBusy = false;
    }
  }

  $effect(() => {
    void refreshHealth();
  });

  const interpretation = $derived(orchestrator.lastInterpretation as InterpretationResult | null | undefined);
</script>

<div class="brain">
  <details class="explainer">
    <summary>How Nexus Brain works (star topology)</summary>
    <ol class="flow">
      <li><strong>Intake</strong> — interpret the goal (or synthetic intake for document teach).</li>
      <li><strong>Recall</strong> — search similar outcomes in SQLite memory.</li>
      <li><strong>Strategy</strong> — plan with lessons from past runs.</li>
      <li><strong>Compliance</strong> — Law 25–style masking on plans and payloads where configured.</li>
      <li><strong>Specialist</strong> — edge model executes with tools; inputs/outputs are audited.</li>
      <li><strong>Reflection</strong> — quality check; may escalate to HITL.</li>
      <li><strong>Memory</strong> — results are logged for future recall.</li>
    </ol>
    <p class="links">
      Open <strong>Observe</strong> for the live thought stream and <strong>Review → Compliance</strong> for the audit
      log.
    </p>
  </details>

  <section class="block">
    <h2>Runtime</h2>
    <p class="hint">
      Live view of orchestrator state, intake, and server health. Optional <code>NEXUS_API_KEY</code> protects API
      routes; store the same key here for the UI (sent as Bearer / query for SSE). After changing the key, reload the
      page so the live event stream reconnects.
    </p>
    <div class="row">
      <label class="keylab">
        API key (local only)
        <input
          type="password"
          autocomplete="off"
          bind:value={apiKeyInput}
          placeholder="Paste if server uses NEXUS_API_KEY"
        />
      </label>
      <button type="button" class="btn" onclick={() => void saveApiKey()}>Save</button>
      <button type="button" class="btn secondary" onclick={() => void refreshHealth()}>Refresh health</button>
    </div>
    {#if healthErr}
      <p class="err">{healthErr}</p>
    {:else if health}
      <pre class="json">{JSON.stringify(health, null, 2)}</pre>
    {/if}
  </section>

  <section class="block">
    <h2>Orchestrator snapshot</h2>
    <ul class="kv">
      <li><span class="k">orchestratorId</span> <span class="v">{orchestrator.orchestratorId}</span></li>
      <li><span class="k">status</span> <span class="v">{orchestrator.status}</span></li>
      <li><span class="k">processing</span> <span class="v">{String(orchestrator.processing)}</span></li>
      <li><span class="k">modelMode</span> <span class="v">{orchestrator.modelMode}</span></li>
      <li><span class="k">currentTaskId</span> <span class="v mono">{orchestrator.currentTaskId ?? '—'}</span></li>
      <li><span class="k">lastSessionId</span> <span class="v mono">{orchestrator.lastSessionId ?? '—'}</span></li>
      <li><span class="k">thoughts</span> <span class="v">{orchestrator.thoughtStream.length}</span></li>
      <li><span class="k">pending HITL</span> <span class="v">{orchestrator.pendingInterventions.length}</span></li>
      <li><span class="k">lastUpdated</span> <span class="v mono">{orchestrator.lastUpdated}</span></li>
    </ul>
  </section>

  <section class="block">
    <h2>Last intake (interpretation)</h2>
    {#if interpretation}
      {#if interpretation.intakeAcknowledgment}
        <p class="intake-ack">{interpretation.intakeAcknowledgment}</p>
      {/if}
      <pre class="json">{JSON.stringify(interpretation, null, 2)}</pre>
    {:else}
      <p class="muted">No interpretation yet — run a task to populate intake.</p>
    {/if}
  </section>

  <section class="block">
    <h2>Persisted session file</h2>
    <p class="hint">Loads <code>DATA_DIR/sessions/&lt;id&gt;.json</code> for the session id stored from the Run tab.</p>
    <button type="button" class="btn" disabled={loadBusy} onclick={() => void loadPersistedSession()}>
      {loadBusy ? 'Loading…' : 'Load session from disk'}
    </button>
    {#if sessionErr}
      <p class="err">{sessionErr}</p>
    {/if}
    {#if sessionJson}
      <pre class="json">{sessionJson}</pre>
    {/if}
  </section>
</div>

<style>
  .brain {
    display: grid;
    gap: 1rem;
  }

  .explainer {
    padding: 0.65rem 0.85rem;
    border-radius: var(--radius, 0.5rem);
    border: 1px solid var(--border, #2a3142);
    background: var(--surface, #12161f);
  }

  .explainer summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--text, #e8eaf4);
  }

  .flow {
    margin: 0.5rem 0 0;
    padding-left: 1.2rem;
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text-muted, #8b92a8);
  }

  .flow li {
    margin-bottom: 0.25rem;
  }

  .links {
    margin: 0.55rem 0 0;
    font-size: 0.76rem;
    color: var(--text-muted);
  }

  h2 {
    margin: 0 0 0.35rem;
    font-size: 0.95rem;
    font-weight: 650;
  }

  .block {
    padding: 0.65rem 0.75rem;
    border-radius: 0.5rem;
    background: #141821;
    border: 1px solid #2a2f3a;
  }

  .intake-ack {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    line-height: 1.45;
    color: #b8c5e8;
    padding: 0.45rem 0.55rem;
    border-radius: 0.35rem;
    border: 1px solid #2f3d5c;
    background: #151a26;
  }

  .hint {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    color: #8b90a3;
    line-height: 1.4;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: flex-end;
    margin-bottom: 0.5rem;
  }

  .keylab {
    display: grid;
    gap: 0.2rem;
    font-size: 0.72rem;
    color: #9a9db0;
    flex: 1 1 14rem;
  }

  input {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.5rem;
    border-radius: 0.35rem;
    border: 1px solid #2f3542;
    background: #0f1115;
    color: #e8e8ec;
  }

  .btn {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.4rem 0.65rem;
    border-radius: 0.35rem;
    border: 1px solid #3d6df4;
    background: #2f4fd4;
    color: #fff;
    cursor: pointer;
    height: fit-content;
  }

  .btn.secondary {
    border-color: #3a4150;
    background: #1a1f28;
    color: #c9cad8;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .json {
    margin: 0;
    padding: 0.5rem 0.55rem;
    border-radius: 0.35rem;
    background: #0f1115;
    border: 1px solid #252b36;
    font-size: 0.72rem;
    line-height: 1.35;
    overflow: auto;
    max-height: 22rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .kv {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.25rem;
    font-size: 0.8rem;
  }

  .kv li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    align-items: baseline;
  }

  .k {
    color: #7d8299;
    min-width: 8rem;
  }

  .v {
    color: #e2e4f0;
  }

  .mono {
    font-family: ui-monospace, monospace;
    font-size: 0.76rem;
    word-break: break-all;
  }

  .muted {
    margin: 0;
    font-size: 0.82rem;
    color: #7d8299;
  }

  .err {
    margin: 0.35rem 0 0;
    color: #ff8b7a;
    font-size: 0.82rem;
  }

  code {
    font-size: 0.85em;
    color: #a8b4ff;
  }
</style>
