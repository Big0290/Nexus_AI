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
- **Teach from the web (controlled crawl)**: Operators can start from a **seed URL**; the server fetches HTML within scope, honors **`robots.txt`**, applies **rate limits** and **SSRF checks**, optionally pulls **sitemap** URLs, extracts **linked documents** (e.g. PDFs) with the same extractors as uploads, **masks** combined text, then runs **`web_teach`**. This does **not** replace legal review: you need rights to copy/process the target (license, ToS, DPIA).

---

## Repository layout

| Package        | Role |
|----------------|------|
| **`brain-core`** | Types, `BrainOrchestrator`, interpretation, reflection, SQLite outcome memory, **Law 25 auditor**, **session store** (incl. document ingest binding). |
| **`agents`**     | Specialist executor (Gemini). |
| **`server`**     | Hono API, SSE, **document ingest** (mask, manifest, optional vision), **web crawl ingest** (robots, SSRF, optional sitemap/headless), **upload TTL cleanup**, compliance audit persistence, task runs. |
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

### Web crawl ingest API

| Step | Endpoint | Notes |
|------|----------|--------|
| Crawl | `POST /api/teach/crawl` | JSON: **`seedUrl`** (https by default), optional **`sessionId`** (UUID), **`maxPages`**, **`maxDepth`**, **`allowedHosts`** (array), **`attestationAccepted`** (boolean when `WEB_CRAWL_REQUIRE_ATTESTATION=1`), optional **`ignoreRobots`** (boolean; **only** when `WEB_CRAWL_ALLOW_IGNORE_ROBOTS=1` — temporary dev/testing; not for production). **One ingest at a time** per server (shared mutex with upload; **429** if busy). Response matches upload shape: `ingestId`, `sessionId`, `manifest`, `maskedTextChars`, `sourceFiles`. |
| Teach | `POST /api/tasks` | JSON: **`taskType: "web_teach"`**, same **`sessionId`** / **`ingestId`** binding as uploads. Rejects if the ingest was not produced by crawl (**400**). `document_teach` remains for file uploads; crawl ingests can also use **`document_teach`** if you want the same task type with web-derived `source` metadata. |

**Health / ops:** `GET /api/health` includes `ingestBusy` (alias `uploadBusy` for compatibility), `ingestStats` (`uploadsOk`, **`crawlOk`**, failure counts, vision file count), orchestrator `busy` / processing flags, and basic config hints.

**Structured audit logging:** Successful crawls log JSON lines with `event: "web_crawl_complete"` including `crawlJob` and `skippedByRobots` / `skippedByPolicy` tallies. Ingest manifest stores per-URL rows under `pages` / `assets` with optional `skippedReason` for debugging (no raw page bytes on disk by default).

### Outcome memory API

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/memory` | Query: `limit`, optional `category`, `tag`, `q`. |
| `GET` | `/api/memory/meta` | Lists categories and tags for filters. |
| `PATCH` | `/api/memory/:id` | JSON body with any of: `result`, `interpretedGoal`, `primaryCategory`, `canonicalQuery`, `tags` (string array), `successScore` (0–1), `failureReason`. At least one field required. |
| `POST` | `/api/memory/:id/teach` | Body: `outcome` (`success` \| `failure`), optional `failureReason` — quick relabel for training. |

The dashboard **Knowledge** tab supports browsing, **Edit** (PATCH), and **+OK / +Fail** (teach).

### Ingest-related environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `UPLOAD_MAX_MB` | `25` | Maximum **total** size of one multipart upload (all files combined). |
| `UPLOAD_MAX_PER_FILE_MB` | same as `UPLOAD_MAX_MB` | Maximum size **per file** in that upload. |
| `UPLOAD_TTL_DAYS` | `30` | Delete `data/uploads/<uuid>/` trees older than this (`0` disables scheduled cleanup). |
| `GEMINI_VISION_ON_INGEST` | on | Set to `0` or `false` to **disable** Gemini Vision for scanned PDFs/images during ingest (no raw bytes sent to Google for those paths). |
| `GEMINI_VISION_MODEL` | `gemini-2.0-flash` | Vision model for ingest (see `server/src/gemini-vision.ts`). |

### Web crawl environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `WEB_CRAWL_USER_AGENT` | `NexusBrainTeach/1.0 (+https://github.com/nexus-brain)` | Sent on all crawl fetches (include contact URL in production). |
| `WEB_CRAWL_DELAY_MS` | `1000` | Minimum delay between requests to the same origin (combined with `Crawl-delay` from robots, capped). |
| `WEB_CRAWL_TIMEOUT_MS` | `25000` | Per-URL fetch timeout. |
| `WEB_CRAWL_MAX_PAGES` | `20` | Max HTML pages per job (overridable per request). |
| `WEB_CRAWL_MAX_DEPTH` | `2` | Max link depth from the seed (overridable per request). |
| `WEB_CRAWL_MAX_TOTAL_MB` | `30` | Max total response bytes approximated per job (server can set via env only). |
| `WEB_CRAWL_PER_URL_MAX_MB` | `10` | Max bytes read per URL response. |
| `WEB_CRAWL_MAX_ASSETS` | `15` | Max linked documents (PDF, spreadsheets, etc.) per job. |
| `WEB_CRAWL_ROBOTS_CRAWL_DELAY_CAP_MS` | `30000` | Upper bound for robots `Crawl-delay` (milliseconds). |
| `WEB_CRAWL_ALLOW_IGNORE_ROBOTS` | off | Set to `1` so `ignoreRobots: true` on `POST /api/teach/crawl` skips **allow/deny** checks from `robots.txt` (still fetches snapshots for diagnostics; **dev/testing only** — remove before shipping). |
| `WEB_CRAWL_ALLOW_HTTP` | off | Set to `1` to allow `http:` seed and links (dev only). |
| `WEB_CRAWL_ALLOW_PRIVATE_HOSTS` | off | Set to `1` to disable SSRF DNS checks (**dangerous**; local dev only). |
| `WEB_CRAWL_ALLOWED_HOSTS` | _(empty)_ | Optional comma-separated host allowlist (and `*.suffix` rules). When set, the seed must match and stricter policy applies. When **empty**, the seed host and its **`www.`** counterpart (e.g. `example.com` ↔ `www.example.com`) are treated as the same scope for redirects and links. |
| `WEB_CRAWL_REQUIRE_ATTESTATION` | off | Set to `1` to require `attestationAccepted: true` on `POST /api/teach/crawl`. |
| `WEB_CRAWL_USE_SITEMAP` | off | Set to `1` to merge `/sitemap.xml` (and nested index) URLs into the crawl queue when allowed by robots. |
| `WEB_CRAWL_SITEMAP_MAX_FETCHES` | `12` | Cap on sitemap XML documents fetched per job. |
| `WEB_CRAWL_SITEMAP_MAX_URLS` | `400` | Cap on `<loc>` URLs collected from sitemaps per job. |
| `WEB_CRAWL_CROSS_ORIGIN_ASSETS` | off | When an allowlist is configured, set to `1` to allow linked documents on any **listed** host (HTML still follows scope rules). |
| `WEB_CRAWL_HEADLESS` | off | Set to `1` for optional Playwright (Chromium). Used when static HTML text is very short, and as a **fallback** when plain `fetch` gets **403 / 429 / 5xx** or a **200 non-HTML** body (**allowlisted hosts only**). |
| `WEB_CRAWL_HEADLESS_ALLOWED_HOSTS` | _(empty)_ | Comma-separated hosts where headless is allowed, e.g. `www.canadapost-postescanada.ca`. **Recommended:** set this in production so headless runs only where you expect. When **empty**, any in-scope host may use headless (if `WEB_CRAWL_HEADLESS=1`). |
| `WEB_CRAWL_HEADLESS_MIN_CHARS` | `120` | Minimum characters of visible text required to accept headless output (including fallback-after-error recovery). Lower (e.g. `60`) if pages are very short. |
| `WEB_CRAWL_HEADLESS_USER_AGENT` | _(empty)_ | Optional Chromium User-Agent string for Playwright. When **empty**, a current Chrome-like UA is used (recommended when plain `fetch` gets 5xx from bot-sensitive origins). |
| `WEB_CRAWL_AUTH_ORIGINS` | _(empty)_ | Comma-separated hostnames allowed to receive optional auth headers. |
| `WEB_CRAWL_AUTH_COOKIE` | _(empty)_ | Raw `Cookie` header value for those origins (**secret**; never returned by APIs or stored in manifests). |
| `WEB_CRAWL_AUTH_BEARER` | _(empty)_ | Optional `Authorization` token for those origins (prefix `Bearer ` added when missing; **secret**). |

**Playwright (headless crawl):**

1. From the **`server/`** directory run: `npx playwright install chromium` (the `playwright` npm package alone does not ship browser binaries).
2. In **`.env`** (repo root or wherever you load env from), set:
   - `WEB_CRAWL_HEADLESS=1`
   - `WEB_CRAWL_HEADLESS_ALLOWED_HOSTS=www.canadapost-postescanada.ca` — comma-separated list of hostnames where Chromium may run (use this to avoid headless on arbitrary sites).
3. Restart the **Nexus API server** so the new variables are picked up.

If plain `fetch` still gets **HTTP 500** (or 403/429) for a URL that works in Chrome, the crawler will try **headless `page.goto`** on that URL **only** for hosts listed in `WEB_CRAWL_HEADLESS_ALLOWED_HOSTS`. Pages recovered this way have `recoveredViaHeadless: true` on the manifest `pages[]` row and **do not** enqueue follow-up links (no HTML snapshot from the failed fetch).

### Law 25 / DPIA notes

- **Masking** (`Law25Auditor`) runs on combined extracted text before it is stored as `masked.txt` and before `document_teach` uses it. Patterns are heuristic (email, phone, etc.); legal review may require more categories or processes.
- **Audit trail**: Mask-related events append to `data/compliance-audit.jsonl` (and in-memory list served by `GET /api/audit`). Ingest uses the **same** auditor instance as task runs so entries stay consistent.
- **Gemini Vision**: when enabled, **raw file bytes** for images and text-poor PDFs are sent to Google; only the **model’s returned text** is masked afterward. For stricter subprocessors or residency requirements, set `GEMINI_VISION_ON_INGEST=0` and/or use regional controls outside this repo.
- **Originals** under `data/uploads/.../original/` are **not** masked. Protect them with filesystem permissions, encryption at rest (volume/KMS), retention policy, and backups appropriate to your DPIA.
- **Web crawl:** By default the server does **not** persist raw HTML/PDF bytes for crawl jobs—only **masked** combined text plus URL/metadata in `manifest.json`. Headless rendering runs JavaScript in a local browser when enabled; document that in your DPIA. **Technical controls (robots, rate limits, SSRF) are not a substitute** for confirming you may scrape or copy the target content.

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
