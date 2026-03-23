# Nexus Brain

**Nexus Brain** is a metacognitive AI orchestrator: a supervisor (“Brain”) at the center of a star topology, coordinating intake, memory, strategy, specialist execution, reflection, and human-in-the-loop gates—with **Quebec privacy-aware** handling (Law 25–oriented audit trails) and a **SQLite-backed knowledge store** for durable outcomes.

We are building this as the foundation for a **startup based in Montreal, Quebec, Canada**—shipping trustworthy, operator-friendly AI systems for teams that need clarity, auditability, and control—not a black box.

---

## Why this exists

- **Supervisor + specialists**: One orchestrator coordinates tasks; edge agents execute with scoped prompts and tools.
- **Knowledge that compounds**: Outcomes are stored, tagged, and recalled—not lost after each chat turn.
- **Humans in the loop when it matters**: Pre-flight clarification for vague asks, and quality gates when confidence is low.
- **Teach from documents**: Upload PDFs, spreadsheets, and images; extract and mask PII locally where possible, then learn into memory.

---

## Repository layout

| Package        | Role |
|----------------|------|
| **`brain-core`** | Types, `BrainOrchestrator`, interpretation, reflection, SQLite outcome memory, Law 25 auditor, session helpers. |
| **`agents`**     | Specialist executor (Gemini). |
| **`server`**     | Hono API, SSE, document ingest, task runs. |
| **`ui`**         | Svelte 5 dashboard (run tasks, HITL, audit, memory). |

---

## Quick start

**Requirements:** Node.js **≥ 20**.

```bash
npm install
npm run build
```

**Development** (API + UI with proxy):

```bash
npm run dev
```

- UI: Vite dev server (e.g. `http://localhost:5173`)
- API: configured in the server package (default `8787` unless overridden)

Copy and configure environment variables from your deployment secrets (e.g. `GEMINI_API_KEY`, `DATA_DIR`, optional `NEXUS_API_KEY`, `SQLITE_PATH`).

---

## Principles

- **Operator-grade**: Thought stream, interventions, and compliance excerpts are first-class—not an afterthought.
- **Privacy-conscious**: Masking and audit logging are designed with Canadian operators in mind; extend policies to match your legal review.
- **Montréal-built**: We care about building serious product in **Montréal, Québec**—bilingual markets, regulated industries, and real-world deployment constraints.

---

## Contributing

This repo is under active development. Issues and design discussions are welcome as we grow the company narrative alongside the codebase.

---

## License

Proprietary / all rights reserved unless and until a public license is published by the project owners.
