# ADR-001 — Incremental layered architecture (no rewrite)

## Status

Accepted

## Context

Leads Marketing Tool is a working Next.js + Prisma + PostgreSQL product: lead pipeline, Actor Manager, freelance platform agents, human approval. The developer wants professional data-science and AI-engineering structure (layers, contracts, experiments, evaluation).

A full move to a textbook `src/domain` / `src/intelligence` / `src/orchestration` tree would break imports, `server-only` boundaries, and a verified production build.

## Decision

1. Keep the **running application** in `src/app` and `src/lib`.
2. Treat the eight layers as **logical ownership**, documented in `docs/architecture/`.
3. Migrate **one concern at a time** (schemas, signals, tests, prompt versions) when a feature needs it.
4. Do not upgrade Prisma. Do not invent unofficial APIs. Do not remove the approval gate.
5. Record further decisions as ADR-002+.

## Consequences

- New code should land in the layer that owns it, even if the folder is still `src/lib/...`.
- Folder moves are allowed only with tests + `tsc` + production build, and never as a drive-by in an unrelated feature.
- Documentation and evaluation datasets can land immediately without moving runtime files.

## Related implicit decisions (to promote to ADRs later)

- ADR-002 candidate: PostgreSQL is the source of truth; Sheets is export.
- ADR-003 candidate: Apify is an adapter, not the scraping architecture.
- ADR-004 candidate: Human approval is required for external outreach and marketplace messages.
- ADR-005 candidate: AI providers are abstracted (`AIProvider`); heuristic mode is labeled.
