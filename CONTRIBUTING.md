# Contributing to Leads Marketing Tool

This is a research-to-production AI system. Do not treat it as a pile of agents.

## Before you write code

Identify:

1. What data enters and leaves?
2. Which layer owns it? (data, intelligence, agent, orchestration, tool, app, analytics, infra)
3. Which agent and tool, if any?
4. How will it be tested?
5. How will success be measured?

Workflow:

```text
Problem → Requirements → Architecture → Data contract
  → Implementation → Unit test → Integration test
  → Evaluation → Documentation → Production
```

Do not start a feature by opening a giant `utils.ts`. Prefer the smallest change that reuses existing abstractions.

## Architecture rule

Inspect current architecture first. See [docs/architecture/overview.md](docs/architecture/overview.md).

- Do not restructure the repository for every feature.
- Do not upgrade Prisma.
- Do not invent unofficial APIs.
- Do not send messages without human approval.
- Do not put production logic in notebooks.

## Tests

```bash
npm test
npx tsc --noEmit
npx next build
```

Add tests next to the layer you change. Minimum: validators, normalizers, scoring, task transitions.

## Commits

Use focused messages:

```text
feat: add memory manager
fix: prevent duplicate leads
test: add qualification evaluation dataset
docs: document agent architecture
```

Do not mix unrelated changes. Do not commit `.env*` or secrets.

## Experiments

Record significant prompt/model changes under `experiments/` with id, date, agent, model, prompt version, dataset, settings, evaluation, notes. Do not overwrite production prompts without a version.
