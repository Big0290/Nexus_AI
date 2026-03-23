<script lang="ts">
  import type { ComplianceAuditEntry, OrchestratorState, ThoughtStreamEntry } from './lib/types.js';
  import { connectBrainEvents, fetchAudit, fetchOrchestratorState } from './lib/api.js';
  import { summarizeBrainError } from './lib/brain-errors.js';
  import TaskForm from './components/TaskForm.svelte';
  import DocumentTeachPanel from './components/DocumentTeachPanel.svelte';
  import ThoughtStream from './components/ThoughtStream.svelte';
  import InterventionQueue from './components/InterventionQueue.svelte';
  import CompliancePanel from './components/CompliancePanel.svelte';
  import OutcomeMemoryPanel from './components/OutcomeMemoryPanel.svelte';
  import FullContentModal from './components/FullContentModal.svelte';
  import BrainOverview from './components/BrainOverview.svelte';

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
  /** Last successful run (one line) */
  let lastSuccess = $state<string | null>(null);
  /** Last failed run — banner + optional modal */
  let taskError = $state<{ title: string; hint: string; detail: string } | null>(null);

  type TabId = 'run' | 'stream' | 'hitl' | 'audit' | 'memory' | 'brain';
  let tab = $state<TabId>('run');

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
        const r = ev.result as {
          status?: string;
          finalResult?: string;
          error?: string;
        };
        if (r.status === 'error' && r.error) {
          const s = summarizeBrainError(r.error);
          taskError = { title: s.title, hint: s.hint, detail: s.detail };
          lastSuccess = null;
        } else {
          taskError = null;
          const bit = r.finalResult?.trim() ? r.finalResult!.slice(0, 280) : '';
          lastSuccess = r.status === 'completed' ? (bit ? `Completed: ${bit}` : 'Completed') : `${r.status ?? 'done'}`;
        }
        void refreshSideData();
      }
    });
    void refreshSideData();
    return off;
  });

  const tabs: { id: TabId; label: string; hint: string }[] = [
    { id: 'run', label: 'Run', hint: 'New task' },
    { id: 'stream', label: 'Stream', hint: 'Thoughts' },
    { id: 'hitl', label: 'HITL', hint: 'Interventions' },
    { id: 'audit', label: 'Audit', hint: 'Law 25' },
    { id: 'memory', label: 'Memory', hint: 'Outcomes' },
    { id: 'brain', label: 'Brain', hint: 'Intake + health' }
  ];
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
        <span class="pill dim">HITL {orchestrator.pendingInterventions.length}</span>
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

  <nav class="tabs" aria-label="Primary">
    {#each tabs as t (t.id)}
      <button
        type="button"
        class="tab"
        class:active={tab === t.id}
        title={t.hint}
        onclick={() => (tab = t.id)}
      >
        {t.label}
      </button>
    {/each}
  </nav>

  <section class="panel">
    {#if tab === 'run'}
      <div class="run-stack">
        <TaskForm />
        <DocumentTeachPanel />
      </div>
    {:else if tab === 'stream'}
      <ThoughtStream entries={thoughts} {openDetail} />
    {:else if tab === 'hitl'}
      <InterventionQueue items={orchestrator.pendingInterventions} {openDetail} afterHitlAction={refreshSideData} />
    {:else if tab === 'audit'}
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
    border: 1px solid #2f3542;
    color: #d0d3e6;
    background: #141821;
  }

  .pill.dim {
    color: #9a9db0;
  }

  .pill.accent {
    border-color: #2a6b5e;
    background: #152a26;
    color: #7dffc8;
  }

  .last {
    margin: 0;
    font-size: 0.78rem;
    color: #9a9aaa;
    max-width: min(42rem, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.65rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid #252b36;
  }

  .tab {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.35rem 0.65rem;
    border-radius: 0.35rem;
    border: 1px solid transparent;
    background: transparent;
    color: #b4b8c9;
    cursor: pointer;
  }

  .tab:hover {
    background: #1a1f28;
    color: #e8e9f0;
  }

  .tab.active {
    border-color: #3d6df4;
    background: #1e2a4a;
    color: #e8ecff;
  }

  .panel {
    min-height: 12rem;
  }

  .run-stack {
    display: grid;
    gap: 0.75rem;
  }

  .alert {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.65rem 1rem;
    margin-bottom: 0.75rem;
    padding: 0.65rem 0.85rem;
    border-radius: 0.45rem;
    border: 1px solid #5c2a2a;
    background: linear-gradient(135deg, #1f1418 0%, #1a1520 100%);
  }

  .alert.error {
    border-color: #8a3d3d;
  }

  .alert-body {
    flex: 1 1 16rem;
    min-width: 0;
  }

  .alert-title {
    display: block;
    font-size: 0.88rem;
    font-weight: 650;
    color: #ffb4a8;
    margin-bottom: 0.35rem;
  }

  .alert-hint {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: #d8c4c0;
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
    border-radius: 0.35rem;
    border: 1px solid #6a4a4a;
    background: #2a1f22;
    color: #f0e0dc;
    cursor: pointer;
  }

  .alert-btn:hover {
    background: #3a2a30;
  }

  .alert-btn.ghost {
    border-color: #3a4150;
    background: transparent;
    color: #a8a9b8;
  }
</style>
