# Data

Data is a first-class layer. Agents consume **typed, validated, lineage-bearing** records. They do not parse raw marketplace JSON in the UI.

---

## Purpose

Move data through:

```text
RAW → INGESTION → VALIDATION → CLEANING → NORMALIZATION
    → FEATURES / SIGNALS → (intelligence / agents)
    → OUTCOME → FEEDBACK → MEMORY / DATA
```

Never modify raw source data in place. Store the original payload; transform into copies.

---

## Current homes

| Concern | Today | Target |
| --- | --- | --- |
| Raw lead payload | `Lead.rawPayload` (JSON) | Same + optional `data/raw/` export |
| Normalize / clean | `src/lib/leads/normalize.ts` | `src/data/normalization` (move later) |
| Ingest + dedupe | `src/lib/leads/ingest.ts` | `src/data/ingestion` + `deduplication` |
| Contracts | TypeScript types in `src/types/index.ts` | Zod schemas + inferred types |
| Persistence | Prisma models | Same (Postgres remains SoT) |
| File datasets | `docs/sample-leads.csv` | `data/samples/` |
| Freelance objects | `FreelanceOpportunity`, `GigProfile`, `BuyerInquiry` | Shared `Opportunity` view + platform extras |

Zod is in `package.json` and **not used**. External JSON is cast or loosely typed.

---

## Production vs files

PostgreSQL is the operational store. The `data/` tree is for:

- **raw/** — exported snapshots of source responses (Apify, Sheets). Do not edit.
- **interim/** — one-off transforms, notebooks, mapping experiments.
- **processed/** — analysis-ready extracts (CSV/JSON) that are not the live DB.
- **external/** — third-party reference files.
- **samples/** — tiny fixtures for UI and tests. Never use production dumps to “try the UI”.

If a notebook produces a useful transform, promote it to a production module. Do not ship notebook logic.

---

## Data contracts (required)

Every major object needs a schema. Preferred: Zod at the boundary, TypeScript inside.

| Object | Current type | Schema to add |
| --- | --- | --- |
| Lead (raw in) | `RawLeadInput` | `LeadInputSchema` |
| Lead (normalized) | `NormalizedLead` | `NormalizedLeadSchema` |
| Research | Prisma `LeadResearch` + `EvidenceFinding` | `ResearchReportSchema` |
| Qualification | `ScoreBreakdown` + score row | `QualificationSchema` |
| Marketing opportunity | `OpportunityOutput` | `OpportunitySchema` |
| Freelance opportunity | Prisma `FreelanceOpportunity` | `FreelanceOpportunitySchema` |
| Task | Prisma `Task` | `TaskSchema` |
| Agent result | `AgentResult` | `AgentResultSchema` |
| Memory | Prisma `JarvisMemory` | `MemorySchema` |
| Outreach draft | Prisma `OutreachDraft` | `OutreachDraftSchema` |

Rule:

```text
External data → Validation → Typed internal object
```

Never trust Apify, Sheets, or pasted listing JSON blindly.

---

## Lineage

A lead must answer: where did this come from, which actor produced it, when was it collected?

| Field | On `Lead` today |
| --- | --- |
| `source` | Yes (string: csv, manual, apify, …) |
| `sourceId` | Yes → `LeadSource` |
| `sourceActor` | Yes |
| `sourceUrl` | Yes |
| `rawPayload` | Yes |
| `externalRowId` | Yes |
| `createdAt` | Yes (collection/import time) |
| `source_id` from actor item | Via `externalRowId` / payload |

Gaps: no dedicated `raw_record_id` table; `collection_timestamp` is `createdAt` / campaign run time, not always the actor’s original scrape time. Prefer copying actor `scrapedAt` into metadata when present, without inventing it.

Freelance listings store `source` (`manual`, `manual_inquiry`) and `rawPayload` on import. Official remote IDs stay nullable (`externalId`).

---

## Signals (feature layer)

Do not ask an LLM for every boolean. Extract signals first.

| Signal | Exists today? | Where |
| --- | --- | --- |
| website exists | Implicit | `lead.website` |
| website mobile / quality | Partial | `LeadResearch.websiteQuality` 0–10 |
| has email / phone / LinkedIn | Implicit | lead columns |
| tech signals | Partial | `techSignals` JSON |
| service need signals | Partial | opportunity arrays on research |
| social presence | Implicit | social URL columns |
| business age | No | — |
| recent activity | Partial | `lastActivityAt` |

Target: a `LeadSignals` object written during research, then consumed by scoring and later ML. Keep reasons on the score (`LeadScore.reason`, `evidenceUsed`, `breakdown`).

Scoring must stay three layers:

```text
Raw signals → Feature extraction → AI analysis (optional) → Qualification model → Score
```

`QualificationAgent` already computes a heuristic breakdown, then optionally merges OpenAI JSON. `qualify-core.ts` is a second, freelance-only scorer. Those should become one intelligence module with two **policy** configs (lead temperature vs freelance classification), not two unrelated formulas forever.

---

## Deduplication

`findDuplicate` matches email **or** website host **or** LinkedIn. Merge fills empty fields only. No fuzzy company-name match. Document false merges (shared generic emails) as a known risk.

---

## Failure modes

| Case | Behavior |
| --- | --- |
| Empty row | Skipped (`skippedEmpty`) |
| Invalid URL / email | Dropped field + `urlIssues` / missingFields |
| Suppressed contact | Lead created/updated as `DO_NOT_CONTACT` |
| Duplicate | Update existing; count as duplicate |
| Missing official API | Do not persist fabricated listings |

---

## Example

CSV import of `docs/sample-leads.csv` (also copied conceptually to `data/samples/`):

1. `parseCsv` → objects
2. Map columns → `RawLeadInput`
3. `normalizeLead`
4. `ingestLeads` writes `Lead` + optional `CampaignLead`
5. Pipeline later writes `LeadResearch`, `LeadScore`, `Opportunity`, `OutreachDraft`

Raw CSV bytes are not stored as a file blob today. If lineage of the file matters, export a copy to `data/raw/` or attach the filename on `LeadSource`.

## Google workbook

One spreadsheet, separate tabs — not one mixed sheet:

| Tab | Jarvis owner |
| --- | --- |
| Leads | Marketing intake |
| Upwork | `UpworkAgent` |
| Fiverr | `FiverrAgent` (`record_type` = gig or inquiry) |
| LinkedIn | Reserved; no agent yet |

Configured spreadsheet: set via `GOOGLE_SHEET_ID` or Settings. Creating tabs requires a connected Google account. Samples live in `data/samples/`.
