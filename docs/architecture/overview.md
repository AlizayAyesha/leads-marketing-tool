# Architecture overview

Leads Marketing Tool is a local-first AI workforce for your business. It turns public lead and freelance data into researched, scored, human-approved actions. It is not a collection of independent chatbots.

This document describes **what exists today**, the **target layered architecture**, and the **migration rule**: move code toward layers without a rewrite.

Related:

- [Brain](./brain.md)
- [Data](./data.md)
- [Agents](./agents.md)
- [Memory](./memory.md)
- [ADR-001](../decisions/ADR-001-project-architecture.md)
- Legacy index: [ARCHITECTURE.md](../ARCHITECTURE.md)

---

## Purpose

| Question | Answer |
| --- | --- |
| Who uses it? | Operators |
| What enters? | Leads, listings, gigs, inquiries, campaign actor output |
| What leaves? | Scores, recommended services, drafts, analytics snapshots |
| What never happens in this phase? | Autonomous send, unofficial marketplace APIs, CAPTCHA/anti-bot bypass |

Human loop: **AI prepares → human approves → (later) system sends**.

---

## Current runtime

```text
Next.js App Router (UI + server actions + route handlers)
        │
        ├── Marketing orchestrator   src/lib/agents/orchestrator.ts
        ├── Freelance triage         src/lib/brain/triage.ts
        ├── Task engine              src/lib/queue/engine.ts
        ├── Specialized agents       src/lib/agents/*
        ├── Platform agents          src/lib/platforms/*
        ├── Tools / adapters         src/lib/tools, data-sources, apify
        ├── AIProvider               src/lib/ai
        └── Prisma → PostgreSQL
```

PostgreSQL is the source of truth. Google Sheets is import/export only. Secrets stay server-side (`.env.local`, `Setting`, `GoogleConnection`). Frontend never receives API keys.

---

## Target layers

Do not mix these responsibilities. The current tree lives under `src/lib/*` and `src/app/*`. Target names below are **logical**. Physical moves happen only when a file has a single owner.

| Layer | Owns | Must not own |
| --- | --- | --- |
| 1. Data | Ingest, validate, clean, normalize, persist, lineage | Scoring, prompts, UI |
| 2. Intelligence | Signals, features, scoring models, recommendations | HTTP, Prisma writes of raw source, UI |
| 3. Agent | Specialized work using intelligence + tools | Direct unofficial APIs, hidden scoring |
| 4. Orchestration | Triage, plan, queue, execute, events | Domain scoring, platform credentials |
| 5. Tool / integration | External I/O behind adapters | Business decisions |
| 6. Application | Next.js pages, forms, display | Qualification math, prompt text as source of truth |
| 7. Analytics / evaluation | Metrics, experiments, labeled datasets | Production side effects |
| 8. Infrastructure | Config, Docker, deploy, observability | Product rules |

Closed loop:

```text
RAW → INGEST → VALIDATE → CLEAN → NORMALIZE → SIGNALS
    → AI / AGENTS → DECISION → ACTION → OUTCOME
    → FEEDBACK → MEMORY / DATA
```

---

## What already exists (keep)

- Lead pipeline: intake → research → qualify → opportunity → strategy → outreach draft → approval
- Evidence contract (`finding`, `evidence`, `reason`, `sourceUrl`, `confidence`)
- Heuristic fallback when OpenAI is unset (labeled, not faked)
- Task queue with retries, timeouts, `AgentRun` history
- Actor Manager + Apify adapter (no fake API success)
- Freelance `PlatformAgent` interface + capability-based triage
- Shared `JarvisMemory` tagged by `platform`
- Human approval for outreach and marketplace drafts
- Lead lineage fields: `source`, `sourceActor`, `sourceUrl`, `rawPayload`, `externalRowId`, `createdAt`

## What is missing (add incrementally)

- Zod (or equivalent) **runtime** contracts — `zod` is installed but unused
- Explicit signal / feature objects separate from LLM prompts
- Prompt versioning (`v1`, `v2`) instead of overwrite-only `Prompt` rows
- `experiments/` records and labeled evaluation datasets
- Structured logging / traces that join workflow → task → agent → model → prompt version
- Test pyramid beyond six freelance unit tests
- File-layer `data/raw|interim|processed` (Postgres holds production data; files are for samples and exports)
- Working / episodic / semantic / procedural memory types (today: one `JarvisMemory` table + lead history tables)

---

## Two brains, one product

Marketing leads and freelance platforms share Postgres and the command bar, but they do **not** yet share one executor.

| Path | Entry | Planner | Workers |
| --- | --- | --- | --- |
| Marketing | `interpretCommand` | Rule/AI intent router | `Task` queue + `getAgent` |
| Freelance | `triageFreelanceCommand` | Capability catalog | `executePlan` + `getPlatformAgent` |

Target: one orchestration layer that plans by **capability**, then dispatches to the correct registry. Do not merge the two registries in one commit.

---

## Failure modes

| Failure | Current behavior | Target |
| --- | --- | --- |
| OpenAI missing / invalid JSON | Heuristic path; UI shows `heuristic` | Same, plus evaluation of heuristic vs model |
| Website 401/403/404 | Recorded as limitation | Same — never evade |
| Official platform API missing | Tool returns `available: false` | Same — never invent endpoints |
| Agent step throws | Task / run marked failed; pipeline continues where possible | Same, plus structured `AGENT_FAILED` event |
| Duplicate lead | Merge non-empty fields | Same, plus lineage of the merge |

---

## What must not change in a migration

- Prisma **6.x** (do not upgrade to 7)
- Human approval before any external message
- PostgreSQL as source of truth
- No unofficial Upwork/Fiverr APIs
- No CAPTCHA, stealth, or rate-limit bypass
- Evidence-bound research (no fabricated portfolio or quotes)
- Next.js App Router + `server-only` for secrets
- Working product routes (`/leads`, `/outreach`, `/freelance`, `/campaigns`, `/integrations`)

---

## Example: a lead through the loop

1. **Raw** — CSV row or Apify item stored on `Lead.rawPayload`
2. **Ingest / validate / normalize** — `normalizeLead` + `ingestLeads`
3. **Signals** — implicit today (email present, website quality, original post)
4. **Agents** — research → qualification → opportunity → writer
5. **Decision** — temperature + recommended service
6. **Action** — draft in `AWAITING_APPROVAL`
7. **Outcome** — operator approve / reject / record contact
8. **Feedback** — `AuditLog`, `OutreachEvent`, later `JarvisMemory`

Freelance listings follow the same loop with `FreelanceOpportunity` and proposal drafts.
