# Data layers

Never edit files in `raw/`. Promote transforms to code when they become product behavior.

| Directory | Role |
| --- | --- |
| `raw/` | Original source snapshots (Apify, Sheets). Immutable. |
| `interim/` | In-progress transforms. |
| `processed/` | Analysis-ready extracts. Not the live database. |
| `external/` | Third-party reference files. |
| `samples/` | Tiny fixtures for development and tests. |

PostgreSQL remains the operational source of truth. See [docs/architecture/data.md](../docs/architecture/data.md).
