<script lang="ts">
  import type { ComplianceAuditEntry, OrchestratorState, ThoughtStreamEntry } from './lib/types.js';
  import { connectBrainEvents, fetchAudit, fetchOrchestratorState } from './lib/api.js';
  import { summarizeBrainError } from './lib/brain-errors.js';
  import type { TaskRunResult } from './lib/types.js';
  import RunPanel from './components/RunPanel.svelte';
  import ThoughtStream from './components/ThoughtStream.svelte';
  import InterventionQueue from './components/InterventionQueue.svelte';
  import CompliancePanel from './components/CompliancePanel.svelte';
  import OutcomeMemoryPanel from './components/OutcomeMemoryPanel.svelte';
  import FullContentModal from './components/FullContentModal.svelte';
  import BrainOverview from './components/BrainOverview.svelte';
  import TaskPhaseStrip from './components/TaskPhaseStrip.svelte';
  import HitlBanner from './components/HitlBanner.svelte';

  const initialState: OrchestratorState = {
    orchestratorId: 'brain-1',
    status: 'idle',
    currentTaskId: null,
    agentState: {
      status: 'idle',
      currentTask: null,
      history: []
    },
    thoughtStream: [],
    pendingInterventions: [],
    lastUpdated: new Date().toISOString(),
    processing: false,
    lastInterpretation: null,
    lastSessionId: null,
    modelMode: 'mock'
  };

  let orchestrator = $state<OrchestratorState>(initialState);
  let thoughts = $state<ThoughtStreamEntry[]>([]);
  let audit = $state<ComplianceAuditEntry[]>([]);
  /** Bumps when side data should reload (memory panel listens). */
  let memoryRefresh = $state(0);
  type LastRunSnapshot = TaskRunResult & { receivedAt: string };

  /** Last successful run (one line, for header when away from Run tab) */
  let lastSuccess = $state<string | null>(null);
  /** Full payload from SSE task_complete — shown on Run tab */
  let lastTaskResult = $state<LastRunSnapshot | null>(null);
  /** Last failed run — banner + optional modal */
  let taskError = $state<{ title: string; hint: string; detail: string } | null>(null);

  /** Primary IA: Run | Observe | Review | Knowledge | System */
  type TabId = 'run' | 'observe' | 'review' | 'memory' | 'brain';
  type ReviewPanelId = 'hitl' | 'audit';
  let tab = $state<TabId>('run');
  let reviewPanel = $state<ReviewPanelId>('hitl');

  let detail = $state<{ title: string; body: string; meta?: string | null } | null>(null);

  function openDetail(title: string, body: string, meta?: string | null) {
    detail = { title, body, meta: meta ?? undefined };
  }

  function closeDetail() {
    detail = null;
  }

  async function refreshSideData() {
    try {
      const a = await fetchAudit(120);
      audit = a.entries as ComplianceAuditEntry[];
    } catch {
      /* offline / cold start */
    }
    memoryRefresh++;
    try {
      const st = (await fetchOrchestratorState()) as OrchestratorState;
      orchestrator = st;
      thoughts = st.thoughtStream;
    } catch {
      /* e.g. NEXUS_API_KEY on server but not in browser — audit/memory may still refresh above */
    }
  }

  $effect(() => {
    const off = connectBrainEvents((ev) => {
      if (ev.type === 'state' && 'state' in ev && ev.state) {
        orchestrator = ev.state as OrchestratorState;
        thoughts = orchestrator.thoughtStream;
      } else if (ev.type === 'task_complete' && 'result' in ev) {
        const r = ev.result as TaskRunResult;
        const snap: LastRunSnapshot = { ...r, receivedAt: new Date().toISOString() };
        lastTaskResult = snap;
        if (r.status === 'error' && r.error) {
          const s = summarizeBrainError(r.error);
          taskError = { title: s.title, hint: s.hint, detail: s.detail };
          lastSuccess = null;
        } else {
          taskError = null;
          const bit = r.finalResult?.trim() ? r.finalResult.trim().slice(0, 200) : '';
          lastSuccess =
            r.status === 'completed'
              ? bit
                ? `Completed · ${bit}${r.finalResult && r.finalResult.length > 200 ? '…' : ''}`
                : 'Completed'
              : r.status === 'awaiting_human'
                ? 'Awaiting human (see Review → Human review)'
                : `${r.status ?? 'done'}`;
        }
        void refreshSideData();
      }
    });
    void refreshSideData();
    return off;
  });

  const primaryNav: { id: TabId; label: string; hint: string }[] = [
    { id: 'run', label: 'Run', hint: 'Tasks and document teach' },
    { id: 'observe', label: 'Observe', hint: 'Thought stream and live reasoning' },
    { id: 'review', label: 'Review', hint: 'Human review (HITL) and compliance audit' },
    { id: 'memory', label: 'Knowledge', hint: 'Outcome memory — browse and edit' },
    { id: 'brain', label: 'System', hint: 'Health, API key, session' }
  ];

  const reviewNav: { id: ReviewPanelId; label: string; hint: string }[] = [
    { id: 'hitl', label: 'Human review', hint: 'Approve, clarify, or override when the Brain pauses' },
    { id: 'audit', label: 'Compliance', hint: 'Law 25 audit log' }
  ];

  const hitlCount = $derived(orchestrator.pendingInterventions.length);
  const viewingHitl = $derived(tab === 'review' && reviewPanel === 'hitl');
</script>

<main class="shell">
  <header class="bar">
    <div class="brand">
      <h1>Nexus Brain</h1>
      <span class="pills">
        <span class="pill">{orchestrator.orchestratorId}</span>
        <span class="pill">{orchestrator.status}</span>
        {#if orchestrator.processing}
          <span class="pill accent">processing</span>
        {/if}
        <span class="pill dim">{orchestrator.modelMode}</span>
        <span class="pill" class:hitl-wait={hitlCount > 0}>HITL {hitlCount}</span>
      </span>
    </div>
    {#if lastSuccess}
      <p class="last" title={lastSuccess}>Last: {lastSuccess}</p>
    {/if}
  </header>

  {#if taskError}
    <div class="alert error" role="alert">
      <div class="alert-body">
        <strong class="alert-title">{taskError.title}</strong>
        <p class="alert-hint">{taskError.hint}</p>
      </div>
      <div class="alert-actions">
        <button
          type="button"
          class="alert-btn"
          onclick={() => {
            const e = taskError;
            if (e) openDetail(e.title, e.detail, 'Full error from Brain / Gemini');
          }}
        >
          Full error
        </button>
        <button type="button" class="alert-btn ghost" onclick={() => (taskError = null)}>Dismiss</button>
      </div>
    </div>
  {/if}

  <TaskPhaseStrip orchestrator={orchestrator} lastThoughtPhase={thoughts[0]?.phase ?? null} />

  {#if hitlCount > 0 && !viewingHitl}
    <HitlBanner
      count={hitlCount}
      onGoToInterventions={() => {
        tab = 'review';
        reviewPanel = 'hitl';
      }}
    />
  {/if}

  <nav class="nav-primary" aria-label="Primary">
    {#each primaryNav as t (t.id)}
      <button
        type="button"
        class="tab"
        class:active={tab === t.id}
        class:hitl-pending={t.id === 'review' && hitlCount > 0}
        title={t.hint}
        onclick={() => (tab = t.id)}
      >
        {t.label}
        {#if t.id === 'review' && hitlCount > 0}
          <span class="tab-badge" aria-hidden="true">{hitlCount}</span>
        {/if}
      </button>
    {/each}
  </nav>

  {#if tab === 'review'}
    <nav class="nav-sub" aria-label="Review">
      {#each reviewNav as r (r.id)}
        <button
          type="button"
          class="subtab"
          class:active={reviewPanel === r.id}
          class:hitl-pending={r.id === 'hitl' && hitlCount > 0}
          title={r.hint}
          onclick={() => (reviewPanel = r.id)}
        >
          {r.label}
        </button>
      {/each}
    </nav>
  {/if}

  <section class="panel">
    {#if tab === 'run'}
      <RunPanel
        lastTaskResult={lastTaskResult}
        onClearLastResult={() => (lastTaskResult = null)}
        onGoKnowledge={() => (tab = 'memory')}
        onGoReview={() => {
          tab = 'review';
          reviewPanel = 'hitl';
        }}
        lastInterpretation={orchestrator.lastInterpretation}
        processing={orchestrator.processing}
      />
    {:else if tab === 'observe'}
      <ThoughtStream entries={thoughts} {openDetail} />
    {:else if tab === 'review' && reviewPanel === 'hitl'}
      <InterventionQueue items={orchestrator.pendingInterventions} {openDetail} afterHitlAction={refreshSideData} />
    {:else if tab === 'review' && reviewPanel === 'audit'}
      <CompliancePanel entries={audit} {openDetail} />
    {:else if tab === 'memory'}
      <OutcomeMemoryPanel {openDetail} refreshKey={memoryRefresh} afterTeach={refreshSideData} />
    {:else}
      <BrainOverview orchestrator={orchestrator} />
    {/if}
  </section>
</main>

<FullContentModal
  open={detail !== null}
  title={detail?.title ?? ''}
  body={detail?.body ?? ''}
  meta={detail?.meta ?? null}
  onClose={closeDetail}
/>

<style>
  .shell {
    max-width: 960px;
    margin: 0 auto;
    padding: 0.75rem 1rem 2rem;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    margin-bottom: 0.5rem;
  }

  .brand {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .pill {
    font-size: 0.72rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--surface);
  }

  .pill.dim {
    color: var(--text-dim);
  }

  .pill.hitl-wait {
    border-color: color-mix(in srgb, var(--phase-hitl) 55%, var(--border));
    color: color-mix(in srgb, var(--phase-hitl) 92%, white);
    background: color-mix(in srgb, var(--phase-hitl) 14%, var(--surface));
    font-weight: 650;
    animation: hitl-pulse 2.2s ease-in-out infinite;
  }

  @keyframes hitl-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--phase-hitl) 0%, transparent);
    }
    50% {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--phase-hitl) 22%, transparent);
    }
  }

  .pill.accent {
    border-color: color-mix(in srgb, var(--teal) 55%, var(--border));
    background: var(--teal-soft);
    color: var(--success);
  }

  .last {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
    max-width: min(42rem, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-primary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
    padding-bottom: 0.45rem;
    border-bottom: 1px solid var(--border);
  }

  .nav-sub {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: -0.15rem 0 0.65rem;
    padding-left: 0.1rem;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 500;
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }

  .tab:hover {
    background: var(--surface-elevated);
    color: var(--text);
  }

  .tab.active {
    border-color: var(--accent-border);
    background: var(--accent-soft);
    color: var(--text);
  }

  .tab.hitl-pending:not(.active) {
    border-color: color-mix(in srgb, var(--phase-hitl) 45%, var(--border));
    color: color-mix(in srgb, var(--phase-hitl) 88%, white);
    background: color-mix(in srgb, var(--phase-hitl) 10%, var(--surface-elevated));
  }

  .tab-badge {
    font-size: 0.62rem;
    font-weight: 750;
    min-width: 1.1rem;
    height: 1.1rem;
    padding: 0 0.28rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--phase-hitl) 88%, #400);
    color: var(--bg);
    line-height: 1.1rem;
    text-align: center;
  }

  .subtab {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.28rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
  }

  .subtab:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .subtab.active {
    border-color: var(--violet);
    color: var(--text);
    background: color-mix(in srgb, var(--violet) 12%, var(--surface));
  }

  .subtab.hitl-pending:not(.active) {
    border-color: color-mix(in srgb, var(--phase-hitl) 40%, var(--border));
    color: color-mix(in srgb, var(--phase-hitl) 85%, white);
  }

  .panel {
    min-height: 12rem;
  }

  .alert {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.65rem 1rem;
    margin-bottom: 0.75rem;
    padding: 0.65rem 0.85rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
    background: var(--danger-soft);
  }

  .alert.error {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
  }

  .alert-body {
    flex: 1 1 16rem;
    min-width: 0;
  }

  .alert-title {
    display: block;
    font-size: 0.88rem;
    font-weight: 650;
    color: color-mix(in srgb, var(--danger) 85%, white);
    margin-bottom: 0.35rem;
  }

  .alert-hint {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .alert-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .alert-btn {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
    background: var(--surface-elevated);
    color: var(--text);
    cursor: pointer;
  }

  .alert-btn:hover {
    background: var(--surface);
  }

  .alert-btn.ghost {
    border-color: var(--border);
    background: transparent;
    color: var(--text-muted);
  }
</style>
