/**
 * Cross-reference model (Nexus Brain) — how IDs connect across browser, API, and stores.
 *
 * **Browser session** (`nexus_brain_session_id` in localStorage)  
 * → UUID shared with the server. Binds chat transcript + teach upload to one thread.
 *
 * **Server session file** (`DATA_DIR/sessions/<sessionId>.json`)  
 * → `turns[]` (user/assistant), optional `documentIngestId` (must match last upload for `document_teach`).
 *
 * **Task** (`taskId`)  
 * → One orchestrator run. Emitted in SSE `task_complete` and stored on outcome rows when logged.
 *
 * **Outcome memory** (`outcomeMemoryId` / SQLite `outcomes.id`)  
 * → Post-mortem row; optional `sessionId`, `taskId` columns link back to thread + run. Shown in Knowledge; “Open Knowledge” from last run uses this id.
 *
 * **Document ingest** (`ingestId`)  
 * → Bound to `sessionId` in the session file; teach flow enforces match. Tags may include `ingest:<uuid>`.
 *
 * **HITL** (`requestId` on `InterventionRequest`)  
 * → Tied to orchestrator state; thought stream may show `requestId` in metadata chips.
 *
 * **Intake retrieval** (`InterpretationResult.memoryLinks`)  
 * → Explicit `outcomeId` + relevance (supporting/contrast/cautionary); not the same as SQL foreign keys.
 *
 * **Gaps**  
 * - `GET /api/memory` filters by category, tag, `q` (text), not by `sessionId`/`taskId` yet — use full-text search or paste id into `q` if it appears in stored text.
 * - `TaskRunResult` does not currently include `sessionId` in the SSE payload (session is known in HTTP handler only).
 */

export {};
