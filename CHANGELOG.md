# Changelog

All notable changes to **Nexus Brain** are recorded here. This file is the project’s running journal for operators and developers.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) (sections: **Added**, **Changed**, **Fixed**, **Security**, **Documentation**). Entries are dated; version tags are optional until releases are published.

---

## [Unreleased]

- _(Add new items under the next dated heading when you ship work.)_

---

## 2025-03-24 — Dashboard transparency, editable memory, richer thought stream

### Added

- **`PATCH /api/memory/:id`**: Partial update of stored outcomes (`result`, `interpretedGoal`, `primaryCategory`, `canonicalQuery`, `tags`, `successScore`, `failureReason`). **`BrainOrchestrator.updateOutcomeMemory`** wraps the SQLite store.
- **UI — Knowledge**: **Edit** dialog on each outcome row; calls `patchMemory` from the client API.
- **UI — Navigation**: Primary tabs grouped as **Run**, **Observe** (thought stream), **Review** (Interventions + Compliance sub-tabs), **Knowledge**, **System**. Global **pipeline** strip shows rough Brain phase from orchestrator state and latest thought.
- **UI — Transparency**: Run tab “what happens next” blurb; System tab collapsible **How Nexus Brain works** (star topology steps).
- **`ThoughtStreamEntry.detail`**: Optional second line on thought entries (safe summaries).
- **Thought stream (backend)**: Richer `metadata` and details for recall (top match preview, `topMatches`), merged recall, strategy (lesson preview), spawn (prompt size, masked payload size, audit ids), reflection (confidence, masked output size; separate line after HITL retry).
- **Thought stream (UI)**: Human-readable phase labels, inline chips from metadata, expand-in-place JSON, **JSON** button for full modal.

### Changed

- **Global CSS**: Design tokens in `app.css` (`--surface`, `--accent`, phase colors, etc.); shell styles updated to use variables.
- **Reflection thought**: Replaced generic “Reflecting…” with a single post-reflection entry summarizing confidence and summary (plus retry path when applicable).

### Documentation

- **README**: Outcome memory API table including PATCH; pointer to Knowledge tab behaviors.

---

## 2025-03-23 — Document ingest hardening & Law 25 alignment

### Security

- **Session-bound ingests**: Successful uploads call `SessionStore.setDocumentIngest(sessionId, ingestId)`. `POST /api/tasks` with `taskType: "document_teach"` requires the same `sessionId` and `ingestId`; mismatch returns **403** (stops guessed-UUID abuse across sessions).
- **Safe ingest paths**: `loadDocumentIngest` accepts only UUID-shaped ids to avoid directory traversal under `data/uploads/`.
- **Single Law 25 auditor instance** for ingest and orchestrator so `GET /api/audit` reflects upload/mask events (same `compliance-audit.jsonl` writer in memory).

### Added

- **`POST /api/teach/upload`**: Optional multipart `sessionId`; response always includes **`sessionId`** (generated if omitted). Structured JSON logs: `ingest_complete`, `ingest_error`.
- **Per-file upload cap**: `UPLOAD_MAX_PER_FILE_MB` (defaults to total cap behavior via `UPLOAD_MAX_MB`).
- **Upload concurrency**: `uploadBusy` mutex; **429** when an upload is already in progress. Exposed on **`GET /api/health`** with **`ingestStats`** (`uploadsOk`, `uploadFailures`, `visionFiles`).
- **Retention**: `UPLOAD_TTL_DAYS` (default 30; `0` disables). Background cleanup of `data/uploads/<uuid>/` by manifest `createdAt` (fallback: directory mtime), on startup and every 24h; logs `upload_cleanup`.
- **`GEMINI_VISION_ON_INGEST`**: When `0`/`false`, Gemini Vision is not used during extract (scanned PDFs/images stay placeholders; no raw bytes to Google for those paths).
- **Tests**: `server` Vitest (`document-ingest.test.ts`); `brain-core` session tests for `documentIngestId` preservation. Root script: `npm test`.
- **`SessionFile.documentIngestId`** and **`setDocumentIngest`**; `appendUser` / `appendAssistant` preserve binding.

### Changed

- **`extractTextFromFile`**: Takes explicit `visionOnIngest` flag; image/PDF vision gated on that flag and API key.
- **UI**: `DocumentTeachPanel` / `postTeachUpload` send and persist `sessionId`; flow uses `sessionId` returned from upload before `document_teach`.
- **`POST /api/tasks` `document_teach`**: **`sessionId` required** (no longer optional random UUID for this task type).

### Documentation

- **README**: Document ingest API table, env vars (`UPLOAD_*`, `GEMINI_VISION_*`), Law 25 / DPIA notes, `npm test`, link to this changelog.

### Notes (operational / legal)

- Original files under `data/uploads/.../original/` remain **unmasked**; vision-off reduces external disclosure but does not replace DPIA, retention policy, or disk access controls. Masking patterns remain heuristic—extend with legal review as needed.

---

## Earlier history

Prior changes were not tracked in this journal. From this date forward, add a new **dated section** when you merge meaningful work (features, fixes, security, or doc-only milestones worth auditing).
