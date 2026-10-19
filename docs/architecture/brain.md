# Brain

The Brain is orchestration: understand a request, plan work, run tasks, emit events, and write memory. It is **not** Upwork, Fiverr, Apify, or the Next.js UI.

---

## Purpose

Turn an operator command or pipeline trigger into a list of capability-based tasks, execute them (in parallel when independent), and record what happened.

Inputs:

- Natural-language Jarvis command
- Explicit pipeline / queue job (`PIPELINE_LEAD`, `RESEARCH_LEAD`, …)
- Campaign / actor run sync

Outputs:

- `JarvisCommandResult` (`intent`, `summary`, `taskIds`, `leadIds`, `data`)
- `Task` + `AgentRun` rows (marketing path)
- `BrainEvent` rows (freelance path)
- Side effects only through agents and tools

Dependencies:

- Capability matcher (`src/lib/brain/capabilities.ts`)
- Planner (`src/lib/brain/planner.ts`)
- Freelance executor (`src/lib/brain/executor.ts`)
- Marketing orchestrator (`src/lib/agents/orchestrator.ts`)
- Queue (`src/lib/queue/engine.ts`)
- Agent registries (marketing + platform)
- Memory (`src/lib/brain/memory.ts`)

---

## Current topology

```text
                    OPERATOR / UI
                          │
                   Jarvis command bar
                          │
              isFreelanceCommand(command)?
                     /            \
                   yes             no
                    │               │
            Freelance triage    Marketing orchestrator
                    │               │
              plan by capability   route intent → enqueue
                    │               │
              executePlan()        processQueue()
                    │               │
           PlatformAgent           SpecializedAgent
                    │               │
                  Tools            Tools / adapters
```

Triage must understand **capabilities**, not hard-coded platform names.

Example capability: `find_freelance_opportunities`  
Available agents: `UpworkAgent`, `FiverrAgent`

---

## Marketing path

1. `interpretCommand` checks freelance first so “Research all new leads” is not stolen.
2. If OpenAI is configured, a JSON router maps the command to an intent.
3. Otherwise a rule router runs.
4. `executeIntent` enqueues `Task` rows (`PIPELINE_LEAD`, `QUALIFY_LEAD`, …).
5. `processQueue` claims due rows, runs `getAgent(slug).execute`, stores `AgentRun`.

Task types live in `src/lib/queue/engine.ts`. Freelance work is **not** on this queue yet.

---

## Freelance path

1. `matchFreelanceCommand` returns a `CapabilityMatch` or `null`.
2. `planFreelanceWork` expands a static catalog (avoids importing `server-only` registries in tests).
3. `executePlan` groups by `parallelGroup` and `Promise.allSettled`s each group.
4. Analytics tasks (`compare_freelance_platforms`, `list_unanswered_opportunities`) run inside the executor, not as platform agents.

Independent search tasks (Upwork + Fiverr) share group `1` and run in parallel.

---

## Events

`emitBrainEvent(type, payload)` writes `BrainEvent`. Types used today include `triage.plan`, `plan.executed`, `upwork.search`, `fiverr.search`.

Marketing uses `AuditLog` + `AgentRun` instead. That split is a gap: there is no single workflow trace ID.

Target trace (not implemented as one object yet):

```text
Workflow ID → Task ID → Agent → Model → Prompt version
          → Tool calls → Output → Validation → Memory
```

---

## Failure modes

| Case | Behavior |
| --- | --- |
| Unknown freelance command | `intent: UNKNOWN`, no tasks |
| Unknown marketing command | Same after routers fail |
| Unknown platform agent id | `getPlatformAgent` throws |
| Task handler throws | Queue marks `FAILED` / `RETRYING`; freelance `executePlan` records `{ ok: false }` |
| Official API unavailable | Tool returns `available: false`; agent still reads stored rows |

Do not “fix” unavailable APIs by inventing endpoints.

---

## Example

Command: `Find me good freelance opportunities.`

1. Capability: `find_freelance_opportunities`, platform `any`
2. Plan: `upwork` search + `fiverr` search (parallel)
3. Each agent calls its tool; tools report official search unavailable
4. Agents return stored opportunities / gigs
5. Summary tells the operator that live search is not connected

Command: `Research all new leads.`

1. Not a freelance command
2. Intent `RESEARCH_NEW`
3. Enqueue `RESEARCH_LEAD` per new lead
4. Queue runs `ResearchAgent`

---

## Migration notes

- Keep capability matching in a **testable** module (no `server-only`).
- Later: one `Orchestration` package that both paths call.
- Do not put scoring or prompt text in the Brain.
- Do not let the UI call tools directly.
