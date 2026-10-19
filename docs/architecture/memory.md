# Memory

Jarvis has one memory system. Platforms are metadata, not separate brains.

Do **not** create `UpworkMemory` or `FiverrMemory`.

---

## Purpose

Remember what was researched, decided, approved, submitted, won, or lost — so later agents and analytics can use history without inventing statistics from tiny samples.

Inputs: `remember({ platform, kind, subject, content, metadata })`  
Outputs: `recall({ platform, kind, take })` plus lead-linked tables  
Dependencies: Prisma `JarvisMemory`, and the marketing history tables listed below

---

## What exists today

### Shared store — `JarvisMemory`

| Field | Role |
| --- | --- |
| `platform` | `upwork`, `fiverr`, or null |
| `kind` | e.g. `project_researched`, `proposal_prepared`, `proposal_approved`, `gig_imported` |
| `subject` | Title / client / gig name |
| `content` | Human-readable lesson or fact |
| `metadata` | ids, classification — no secrets |
| `createdAt` | When remembered |

API: `src/lib/brain/memory.ts` — append-only create + recent recall. No embeddings, no conflict resolution, no TTL.

### Marketing history (episodic, not called “memory”)

These tables **are** memory for leads:

| Table | What it remembers |
| --- | --- |
| `Lead` | Identity, lineage, status |
| `LeadResearch` | Findings, snapshot, limitations |
| `LeadScore` | Score, breakdown, reasons, mode |
| `Opportunity` | Recommended service |
| `OutreachDraft` / `OutreachEvent` | Drafts and operator actions |
| `Conversation` | Relationship stage, signals, and stop reason. Jarvis analyzes replies; it does not send. |
| `AgentRun` / `Task` | What ran and what failed |
| `AuditLog` | Approve / reject / import / export |

Freelance proposals and opportunities are the parallel episodic store for marketplaces.

---

## Target memory types

| Type | Meaning | Today |
| --- | --- | --- |
| Working | Context for the current task | Prompt payload + latest research row |
| Episodic | What happened with a client / lead | Lead tables + `JarvisMemory` rows |
| Semantic | Stable facts (your services, do-not-say) | `src/lib/config.ts`, prompts |
| Procedural | How we work (approval, no unofficial API) | Code + docs |

Do not implement vector search until retrieval tests exist. Keyword / filtered `recall` is enough.

---

## Cross-platform intelligence

Analytics (`src/lib/platforms/analytics.ts`) counts opportunities, qualified, proposals, wins, conversion.

Rule: **do not declare a winning platform** until each side has at least 8 opportunities. Do not infer “budgets below X never convert” from a handful of rows. Write lessons as operator-entered or clearly sample-size-limited.

---

## Memory evaluation (not built)

Test:

- Retrieval accuracy (“What happened with ABC Studio?”)
- Relevance of recalled rows
- Stale memory (old research after a new site fetch)
- Duplicates (same proposal remembered twice)
- Incorrect or conflicting memories

Expected: previous contact + response + opportunity. Retrieved: historical rows for that subject, not another client.

---

## Failure modes

| Case | Behavior |
| --- | --- |
| Recall with no rows | Empty list — agents must not invent history |
| Missing platform tag | Row still stored; harder to filter |
| Tiny N | Analytics returns “not enough data” |
| Secret in metadata | Forbidden — never log tokens |

---

## Example

```text
platform = upwork
kind     = proposal_submitted
subject  = SaaS dashboard
content  = Operator recorded a manual submit. Jarvis did not call a marketplace API.
metadata = { proposalId }
```

Later: “Show me opportunities I haven't responded to” uses **status**, not a guessed memory embedding.

---

## Migration notes

- Keep a single `JarvisMemory` table
- Add `leadId` / `opportunityId` optional FKs when we need joinable recall
- Record `prompt_version` and `model` on runs before claiming memory “learned”
- Lead research already stores `rawSnapshot` — that is raw episodic data; do not delete it when adding file-layer `data/raw/`
