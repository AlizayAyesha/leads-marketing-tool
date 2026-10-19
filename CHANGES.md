# CHANGES: private ZAR JARVIS → public Leads Marketing Tool

## Privacy / removed
- **Old git history dropped**: a fresh repo with one initial commit.
- **97 one-off scripts removed** from `scripts/`. They held hard-coded leads, names, test recipients, Finland/Maps campaigns, the Zar Labs preview-email recipient, and LinkedIn/X send loops. Kept: apify-smoke, smoke-pipeline, print-google-oauth-url, load-local-env, register-server-only, require-script-send, crawl4ai_chrome.py.
- **Hard-coded Google Sheet ID** removed from code and docs. It's now optional via `GOOGLE_SHEET_ID`.
- **Personal Calendly link** removed from code, docs and .env.example. It's now `LINKEDIN_SCHEDULER_URL` / profile `bookingUrl`.
- **Real names, emails and social handles in tests** replaced with fictitious ones (Jane Doe, Sam Tester, example.com).
- **zarlabs.online URLs** (booking hops, contact fallback, user-agents) replaced with `APP_URL` / profile website. "Zar Labs" in prompts, drafts and UI is replaced with the Business Profile name.
- **Internal docs removed**: commercial-doctrine-audit, gap-analysis, marketing-brain, product/jarvis-operating-spec. Also removed: `.cursor/` and CLAUDE.md.
- `.gitignore` now also covers `output/`, logs, `business-profile.json`, browser profiles and cookies.
- Scans: gitleaks found 0 real secrets (4 false positives: `linkedinResearch` identifiers and a fake `apify_api_ABC123456` test fixture). An rg sweep for keys, emails, phone numbers and names is clean.

## Features
- **AI**: one central client (`src/lib/ai/config.ts`, `client.ts`). `AI_PROVIDER=openrouter|openai`, `OPENROUTER_API_KEY` / `OPENAI_API_KEY`, `AI_MODEL` (default `openrouter/free`), optional `AI_BASE_URL`. Heuristic fallback when there's no key. Voice runs only on OpenAI.
- **Apify**: `APIFY_TOKEN` (legacy `APIFY_API_TOKEN` still accepted).
- **Business Profile**: `BusinessProfile` DB model, seeded by `npm run setup`. Edit it at `/settings/business` or in `business-profile.json`. The buyer filter (`buyer-icp`, `wants-services`), people-search titles, prompts, doctrine and drafts all read from it. Location, competitor and exclude-keyword filters are new.
- **Social automation module** (`ENABLE_SOCIAL_AUTOMATION=false` by default) gates the LinkedIn/X send providers and the run-live routes (403 when off).
- **Kill switch**: the "run" buttons no longer turn off `sendsPaused`. Only the Engine panel can.
- **Email**: every send gets a compliance footer (sender name + `OUTREACH_SENDER_ADDRESS` + unsubscribe line), plus the existing List-Unsubscribe header and suppression.
- **Multiple Gmail sender inboxes** (`/settings/senders`): OAuth per inbox, tokens encrypted with AES-GCM, per-inbox `dailySendLimit` (default 1, max `GMAIL_SENDER_MAX_DAILY_LIMIT`=50), round-robin, sent-today counts, warm-up and Google-policy warning.
- **Rebrand**: Leads Marketing Tool (`leads-marketing-tool`), "Built by Zar Labs (zarlabs.online)". **AGPL-3.0-only** LICENSE + NOTICE. `.github/FUNDING.yml`. New README and .env.example.
- Fixed pre-existing type errors so `tsc` and `next build` pass.
