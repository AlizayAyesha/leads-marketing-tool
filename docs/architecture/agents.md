# Agents

An agent is a specialized worker with a slug, a prompt, tools it is allowed to use, and a typed result. Agents do **not** own the Brain, and they do **not** call unofficial platform APIs.

---

## Purpose

Perform one job well: research, score, map a service, write a draft, optimize a gig, etc.

Inputs (marketing): `AgentContext` — `lead`, `prompt`, `payload`  
Inputs (platform): `PlatformTask` — `type`, `payload`  
Outputs: `AgentResult` / `PlatformAgentResult` — `ok`, `output`, `error`, `mode` or `unavailable`

Dependencies: intelligence helpers, tools, Prisma, `AIProvider`, memory, approval tables.

---

## Registries (do not collapse yet)

### Marketing — `src/lib/agents/registry.ts`

| Slug | Class | Job |
| --- | --- | --- |
| `intake` | `IntakeAgent` | Normalize notes / risk flags |
| `research` | `ResearchAgent` | Public website evidence |
| `qualification` | `QualificationAgent` | 0–100, HOT/WARM/COLD/DISQUALIFIED |
| `opportunity` | `OpportunityAgent` | Service mapping (from Business Profile) |
| `strategist` | `StrategistAgent` | Channel, tone, do-not-say |
| `outreach_writer` | `OutreachWriterAgent` | Draft only |
| `follow_up` | `FollowUpAgent` | Suggest follow-up; no send |

Shared interface: `SpecializedAgent`. Shared AI helper: `BaseAgent.askJson`.

### Platform — `src/lib/platforms/registry.ts`

| Id | Class | Capabilities |
| --- | --- | --- |
| `upwork` | `UpworkAgent` | find / import listings |
| `upwork_qualification` | `UpworkQualificationAgent` | score stored opportunities |
| `upwork_proposal` | `UpworkProposalAgent` | draft proposal |
| `fiverr` | `FiverrAgent` | import gigs / inquiries |
| `fiverr_optimizer` | `FiverrGigOptimizerAgent` | gig suggestions |
| `fiverr_response` | `FiverrResponseAgent` | draft buyer reply |

Shared interface: `PlatformAgent` (`id`, `name`, `platform`, `capabilities`, `permissions`, `execute`).

`AGENT_DEFINITIONS` in `src/lib/agents/types.ts` lists both families for seed/UI. Runtime lookup is still split.

---

## Pipeline (marketing)

```text
Intake → Research → Qualification → Opportunity
      → Strategist → Outreach Writer → Human approval
      → (Phase 3) Channel send → Follow-up suggestions
```

`runLeadPipeline` runs the middle five in order. A failed step is recorded; later steps may still run on weaker evidence and must say so.

Rules:

- Independently executable from UI and Jarvis commands
- Do not invent URLs, quotes, or “they requested this service” without `originalPost` / notes
- `DO_NOT_CONTACT` / suppressed leads skip work
- Writer never sends

---

## Platform agents

```text
Triage (capability)
    → UpworkAgent / FiverrAgent
    → UpworkTool / FiverrTool
    → supported API or unavailable
```

Credentials live on `PlatformConnection` / env, never in the agent class.

If an official API is missing, the **adapter stays** and the capability is marked unavailable. Import-by-paste is the supported path.

Drafts: `AWAITING_APPROVAL`. Approve does not submit. Operator may record a manual submit.

Gig optimizer language: “potentially useful”, “worth testing”, “appears relevant”. Never “this keyword will rank”.

---

## Prompts

| Store | Behavior |
| --- | --- |
| `src/lib/prompts/defaults.ts` | Code defaults |
| `Prompt` table | Editable in Agent Control Center; seed does not overwrite existing content |

There is **no prompt version**. Editing the DB row loses history. Target: `src/ai/prompts/<agent>/vN.ts` plus `prompt_version` on `AgentRun` / draft.

Experiments belong in `experiments/prompts` and `experiments/results`, not in production files.

---

## Evaluation (not built)

Every important agent needs a labeled set and metrics. Example for qualification:

- Dataset: ~100 leads with human HOT/WARM/COLD
- Model prediction vs label
- Accuracy, false positive/negative, consistency, reasoning quality

Do not claim an agent improved because a prompt “feels better”.

Minimum tests today: `src/lib/platforms/freelance.test.ts` (capability routing + `qualify-core` honesty). Missing: research, qualification, ingest, queue, memory retrieval.

---

## Failure modes

| Case | Behavior |
| --- | --- |
| No lead on marketing agent | `{ ok: false }` |
| AI JSON invalid | Fall back to heuristic; surface error |
| Tool unavailable | `{ unavailable: true }` with reason |
| Unknown task type | Agent returns error string |
| Proposal without opportunity | Proposal agent fails closed |

---

## Example

Operator: “Prepare email outreach for HOT leads.”

1. Orchestrator intent `PREPARE_OUTREACH`, channel EMAIL, temperature HOT
2. Enqueue `WRITE_OUTREACH` per matching lead
3. `OutreachWriterAgent` reads research + opportunity + strategy
4. Draft stored `AWAITING_APPROVAL`
5. Human edits / approves / rejects on `/outreach`

---

## Migration notes

- Extract `heuristicScore` and `qualifyOpportunity` into `src/intelligence/scoring`
- Keep agent classes thin: load context → call intelligence → persist → remember
- Add agent tests with fixtures in `data/samples/` and `experiments/datasets/`
- Register new platforms as `PlatformAgent`s; do not fork the Brain
