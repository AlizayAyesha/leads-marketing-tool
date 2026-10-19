# Leads Marketing Tool — Architecture index

Canonical docs (read these first):

| Document | Contents |
| --- | --- |
| [architecture/overview.md](./architecture/overview.md) | Layers, current vs target, what not to change |
| [architecture/brain.md](./architecture/brain.md) | Triage, planner, queue, events |
| [architecture/data.md](./architecture/data.md) | Lineage, contracts, signals, file layers |
| [architecture/agents.md](./architecture/agents.md) | Marketing + platform agents, prompts, evaluation |
| [architecture/memory.md](./architecture/memory.md) | Shared JarvisMemory + lead history |
| [decisions/ADR-001-project-architecture.md](./decisions/ADR-001-project-architecture.md) | Incremental migration, no rewrite |

Phase map, UI routes, and safety rules that have not moved yet remain below for operators.

---

## Phase map

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Sheets / CSV / manual → research → qualify → opportunity → draft → approval | Implemented |
| 2 | Apify Actor Manager, campaigns, Sheets export, Discover | Live |
| 3 | Channel send (email / LinkedIn / X) | Live from **Home** via Jarvis Chrome + email wave |
| 4 | Unified orchestration | Split: marketing queue + freelance executor |

Operator loop: **Find → Keep buyers → Reach out (Home buttons) → See skip reasons**.  
Prepare-only path: sheet import + pipeline + drafts (no LinkedIn/X send). Live send is one door per channel on Home.

## UI map

| Route | Section |
| --- | --- |
| `/` | Home — Discover + live channel send + ready/skip stats |
| `/leads` | Lead Intelligence |
| `/leads/[id]` | Lead file |
| `/research` | AI Research |
| `/outreach` | Approval queue + status (send from Home) |
| `/freelance` | Freelance Command Center |
| `/campaigns` | Campaigns |
| `/agents` | Agent Control Center |
| `/jarvis` | Command console |
| `/integrations` | Keys, Apify, Sheets, Browser |
| `/settings` | Suppression, environment |

## Safety

- `DO_NOT_CONTACT` and `Suppression`
- Kill switch + buyer filter (agency / tech peer blocked)
- Email draft approval queue; Home email button is an explicit live wave
- Audit log for approve / reject / import / export / send
- One public website GET per host; 401/403 recorded, not evaded
- No unofficial marketplace APIs
- Scripts under `scripts/` are diagnostics — see `scripts/README.md`
