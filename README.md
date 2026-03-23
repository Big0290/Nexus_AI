# Nexus Brain

**Nexus Brain** is a metacognitive AI orchestrator: a supervisor (“Brain”) at the center of a star topology, coordinating intake, memory, strategy, specialist execution, reflection, and human-in-the-loop gates—with **Quebec privacy-aware** handling (Law 25–oriented audit trails) and a **SQLite-backed knowledge store** for durable outcomes.

We are building this as the foundation for a **startup based in Montreal, Quebec, Canada**—shipping trustworthy, operator-friendly AI systems for teams that need clarity, auditability, and control—not a black box.

**Change journal:** See [`CHANGELOG.md`](CHANGELOG.md) for a dated log of features, security, and documentation updates.

---

## Why this exists

- **Supervisor + specialists**: One orchestrator coordinates tasks; edge agents execute with scoped prompts and tools.
- **Knowledge that compounds**: Outcomes are stored, tagged, and recalled—not lost after each chat turn.
- **Humans in the loop when it matters**: Pre-flight clarification for vague asks, and quality gates when confidence is low.
- **Teach from documents**: Upload PDFs, spreadsheets, and images; text is extracted, **Law 25–masked** (`Law25Auditor`), then fed to the learner. Uploads are **session-bound** so ingest IDs cannot be reused from another client session without a fresh upload.

---

## Repository layout

| Package        | Role |
|----------------|------|
| **`brain-core`** | Types, `BrainOrchestrator`, interpretation, reflection, SQLite outcome memory, **Law 25 auditor**, **session store** (incl. document ingest binding). |
| **`agents`**     | Specialist executor (Gemini). |
| **`server`**     | Hono API, SSE, **document ingest** (mask, manifest, optional vision), **upload TTL cleanup**, compliance audit persistence, task runs. |
| **`ui`**         | Svelte 5 dashboard (run tasks, HITL, audit, memory, teach-from-documents flow). |

---

## Quick start

**Requirements:** Node.js **≥ 20**.

```bash
npm install
npm run build
npm test
```

**Development** (API + UI with proxy):

```bash
npm run dev
```

- UI: Vite dev server (e.g. `http://localhost:5173`)
- API: configured in the server package (default **8787** unless overridden)

Copy and configure environment variables from your deployment secrets (e.g. `GEMINI_API_KEY`, `DATA_DIR`, optional `NEXUS_API_KEY`, `SQLITE_PATH`). Optional API key auth: send `Authorization: Bearer <NEXUS_API_KEY>` or header `X-API-Key` / query `api_key` (see server middleware).

### Document ingest API

| Step | Endpoint | Notes |
|------|----------|--------|
| Upload | `POST /api/teach/upload` | Multipart: `files` (one or more). Optional `sessionId` (UUID); if omitted the server creates one. Response always includes `ingestId` and **`sessionId`** (use this for the next step). Only one upload runs at a time server-side (**429** if busy). |
| Teach | `POST /api/tasks` | JSON: `taskType: "document_teach"`, **`sessionId`** (required, must match upload), **`ingestId`** from the same upload, optional `description`, `focusNote`. |

The server binds each successful upload to a session (`documentIngestId` on the session record). A `document_teach` request is rejected (**403**) if `ingestId` does not match that session—so another caller cannot use a guessed ingest UUID without the same session.

**Health / ops:** `GET /api/health` includes `uploadBusy`, `ingestStats` (upload success/failure counts and vision file count), orchestrator `busy` / processing flags, and basic config hints.

### Ingest-related environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `UPLOAD_MAX_MB` | `25` | Maximum **total** size of one multipart upload (all files combined). |
| `UPLOAD_MAX_PER_FILE_MB` | same as `UPLOAD_MAX_MB` | Maximum size **per file** in that upload. |
| `UPLOAD_TTL_DAYS` | `30` | Delete `data/uploads/<uuid>/` trees older than this (`0` disables scheduled cleanup). |
| `GEMINI_VISION_ON_INGEST` | on | Set to `0` or `false` to **disable** Gemini Vision for scanned PDFs/images during ingest (no raw bytes sent to Google for those paths). |
| `GEMINI_VISION_MODEL` | `gemini-2.0-flash` | Vision model for ingest (see `server/src/gemini-vision.ts`). |

### Law 25 / DPIA notes

- **Masking** (`Law25Auditor`) runs on combined extracted text before it is stored as `masked.txt` and before `document_teach` uses it. Patterns are heuristic (email, phone, etc.); legal review may require more categories or processes.
- **Audit trail**: Mask-related events append to `data/compliance-audit.jsonl` (and in-memory list served by `GET /api/audit`). Ingest uses the **same** auditor instance as task runs so entries stay consistent.
- **Gemini Vision**: when enabled, **raw file bytes** for images and text-poor PDFs are sent to Google; only the **model’s returned text** is masked afterward. For stricter subprocessors or residency requirements, set `GEMINI_VISION_ON_INGEST=0` and/or use regional controls outside this repo.
- **Originals** under `data/uploads/.../original/` are **not** masked. Protect them with filesystem permissions, encryption at rest (volume/KMS), retention policy, and backups appropriate to your DPIA.

---

## Principles

- **Operator-grade**: Thought stream, interventions, and compliance excerpts are first-class—not an afterthought.
- **Privacy-conscious**: Masking and audit logging are designed with Canadian operators in mind; extend policies to match your legal review.
- **Montréal-built**: We care about building serious product in **Montréal, Québec**—bilingual markets, regulated industries, and real-world deployment constraints.

---

## Contributing

This repo is under active development. Issues and design discussions are welcome as we grow the company narrative alongside the codebase. **Document notable changes** in [`CHANGELOG.md`](CHANGELOG.md) when you ship behavior or security-relevant updates.

---

## License

Proprietary / all rights reserved unless and until a public license is published by the project owners.
