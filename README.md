# Leads Marketing Tool

**Open-source lead discovery, qualification and outreach for any business, anywhere.**
Describe your business and ideal customer once. The tool finds matching businesses, researches their public websites, keeps only real buyers, writes personalised drafts, and queues them for your approval before anything is sent.

> Built by **Zar Labs** ([zarlabs.online](https://zarlabs.online)) · License: **AGPL-3.0**

Stack: Next.js 16 · TypeScript · Prisma + PostgreSQL · Apify · OpenRouter / OpenAI · Playwright (optional)

---

## What it does

```
Discover ──► Research ──► Qualify ──► Draft ──► Approve ──► Send (email)
 (Apify,      (public      (your         (AI or     (you, in     (kill switch,
  CSV, Sheets) website)    Business      heuristic) the queue)   caps, suppression,
                           Profile)                              unsubscribe footer)
```

- **Discover**: Google Maps and web search through *your own* Apify account, plus CSV, Google Sheets or manual entry.
- **Research**: reads public company websites to find evidence (outdated site, no booking, hiring posts…).
- **Qualify**: keeps leads that match your **Business Profile**: industries, locations, roles, demand keywords. Drops competitors, agencies, recruiters, juniors and any exclude keywords. Company listings from Google Maps are kept as a **Profile match** (with a score) when they fit that profile and have a website or email. The stricter buying-intent qualification still runs and can mark a lead DISQUALIFIED when there is no explicit request — that does not remove the Profile match.
- **Draft**: email (and optional LinkedIn/X) drafts using your business name, services and booking link.
- **Approve**: nothing goes out until you approve it. A global **kill switch is ON by default**.
- **Email**: sends through your connected Gmail inbox(es), with sender identity, postal address and an unsubscribe line in every email. Opt-outs are suppressed automatically.
- **Optional module**: LinkedIn/X browser automation. **Off by default**; read [Compliance](#compliance--terms-of-service) first.

No AI key? Everything still works in **heuristic mode** (rule-based scoring and template drafts).

## Screenshots

> _Placeholder: add screenshots of Home, Business Profile, Approvals and Sender inboxes here._
>
> `docs/screenshots/home.png` · `docs/screenshots/business-profile.png` · `docs/screenshots/approvals.png`

## Quick start

Requirements: **Node.js 20+**, **Docker** (for Postgres) or any PostgreSQL 14+.

```bash
git clone https://github.com/<you>/leads-marketing-tool.git
cd leads-marketing-tool

cp .env.example .env.local      # then edit keys (see below)
docker compose up -d            # starts Postgres on 127.0.0.1:5432
npm install
npm run setup                   # prisma generate + db push + seed (incl. default Business Profile)
npm run dev                     # http://localhost:3000
```

Then:

1. Open **Business Profile** in the sidebar and describe your business and ideal customer.
2. Go to **Connect → Apify** (or set `APIFY_TOKEN`) and run a discovery, or import a CSV ([sample](data/samples/leads.csv)).
3. Review drafts in **Approvals**.
4. Connect a Gmail inbox (**Sender inboxes**), set `OUTREACH_SENDER_ADDRESS`, and only then switch the kill switch off in **Approvals → Engine**.

## Environment variables

All variables live in `.env.local` (template: [`.env.example`](.env.example)).

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` / `DIRECT_URL` | ✅ | local Docker URL | PostgreSQL connection |
| `APP_URL` | | `http://localhost:3000` | Public URL (used for booking links `/go/website`, `/go/linkedin`) |
| `AI_PROVIDER` | | `openrouter` | `openrouter` or `openai` |
| `OPENROUTER_API_KEY` | | | OpenRouter key (free models available) |
| `OPENAI_API_KEY` | | | OpenAI key (also needed for voice) |
| `AI_MODEL` | | `openrouter/free` / `gpt-4o-mini` | Model id |
| `AI_BASE_URL` | | | Any other OpenAI-compatible endpoint |
| `APIFY_TOKEN` | for discovery | | Your Apify API token |
| `BUSINESS_PROFILE_PATH` | | `./business-profile.json` | Optional profile file |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Gmail/Sheets | | Google OAuth client |
| `GOOGLE_REDIRECT_URI` | | `${APP_URL}/api/google/callback` | OAuth callback |
| `GOOGLE_SHEET_ID` | | | Optional default sheet for import |
| `OUTREACH_FROM_NAME` / `OUTREACH_FROM_EMAIL` | | connected account | Sender identity |
| `OUTREACH_SENDER_ADDRESS` | ✅ for email | | Postal address in the footer |
| `EMAIL_COMPLIANCE_FOOTER` | | `true` | Sender, address and unsubscribe footer |
| `GMAIL_SENDER_MAX_DAILY_LIMIT` | | `50` | Upper bound for any inbox's daily limit |
| `JARVIS_DAILY_SEND_LIMIT` | | `10` | Global daily send cap |
| `QUEUE_PROCESS_SECRET` | | | Secret for `/api/queue/process` |
| `CREDENTIAL_ENCRYPTION_KEY` | recommended | derived | Encrypts stored keys/tokens (`openssl rand -hex 32`) |
| `ENABLE_SOCIAL_AUTOMATION` | | `false` | LinkedIn/X browser automation. Off hides those send cards; Home shows Email only |
| `LINKEDIN_SCHEDULER_URL` | | | Your Calendly/Cal.com link for the booking hop |
| `FIRECRAWL_API_KEY`, `PDL_API_KEY` | | | Optional providers |
| `NEXT_PUBLIC_SUPABASE_*` | | | Optional multi-user auth |

## AI setup: OpenRouter (recommended, free) or OpenAI

The app uses one AI client ([`src/lib/ai/client.ts`](src/lib/ai/client.ts)) that talks to any OpenAI-compatible API. If no key is set, it falls back to heuristic mode.

### Get a free OpenRouter key (step by step)

1. Sign up at **[openrouter.ai](https://openrouter.ai)** with Google, GitHub or email.
2. Open **[openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)** → **Create Key** → copy it. You won't see it again.
3. Paste it into `.env.local`:
   ```env
   AI_PROVIDER=openrouter
   OPENROUTER_API_KEY=sk-or-...
   AI_MODEL=openrouter/free
   ```
4. Choose a model. `openrouter/free` automatically routes to an available free model. To pin one, browse **[free models](https://openrouter.ai/models?max_price=0)** and copy any id ending in **`:free`** into `AI_MODEL`.
5. Restart `npm run dev`. **Settings** should show `AI (OpenRouter) · model …`.

**Free-model limits** (per [OpenRouter docs](https://openrouter.ai/docs/api-reference/limits), at the time of writing): about **20 requests/minute** and **50 requests/day** until you've bought at least 10 credits, then **1000/day**. A negative balance can block free models too. If you hit `429`, wait, buy a few credits, or switch to a paid model. The free model lineup changes often.

### OpenAI instead

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

Voice (speech-to-text / text-to-speech) only works with `AI_PROVIDER=openai`. Otherwise the browser's built-in speech is used.

## Apify setup (bring your own token)

Discovery scrapers run on **your** Apify account, so scraping costs and limits are yours.

1. Sign up at [apify.com](https://apify.com). The free plan includes monthly platform credit.
2. Copy your token from **[console.apify.com/settings/integrations](https://console.apify.com/settings/integrations)**.
3. Set `APIFY_TOKEN=...` in `.env.local`, or paste it in **Connect → Apify** (stored encrypted).
4. Check it: `npx tsx scripts/apify-smoke.ts`.

Watch actor run costs in the Apify console. Start with small result limits.

Google Maps actors (including `compass/crawler-google-places`) put the place link in a field like `url`. That link is stored as the source. It is not the company's website, so it does not fail the portal/search filter. Import drops agencies and tech peers that match your Business Profile exclusions and reports how many were removed. Google Maps categories such as Internet marketing service, Marketing agency, Advertising agency, and Website designer count as agencies. A company that fits your industries and locations and has a real website or email is saved as a **Profile match** with a score. Buying-intent qualification still runs afterwards and can mark the same lead DISQUALIFIED when there is no explicit request.

A full (non-test) actor run can stay **RUNNING** while Apify finishes. The app polls for a few minutes, then **Sync results** on the actor page — or the queue worker — reads the dataset and imports it.

## Business Profile guide

The Business Profile decides **who counts as a lead**. Edit it in **Business Profile** (sidebar), or commit a `business-profile.json` (see [`business-profile.example.json`](business-profile.example.json)). It's loaded at startup, and anything saved in the app takes precedence.

| Field | Used for | Example |
| --- | --- | --- |
| `businessName`, `website`, `description` | Drafts, email footer, AI prompts | "Acme Web Studio" |
| `services` | Drafts + demand matching | `website redesign, online booking` |
| `targetIndustries` | Discovery queries + qualification (empty = any) | `dental clinic, orthodontist` |
| `targetLocations` | Discovery queries + geo filter (empty = worldwide) | `Berlin, Munich` |
| `companySize` | Prompts / query hints | `1-50 employees` |
| `targetRoles` | Buyer-role filter | `owner, practice manager` |
| `includeKeywords` | Signals they need you | `outdated website, no online booking` |
| `excludeKeywords` | Hard exclude | `hospital, university` |
| `competitors` | Always excluded | `Example Dental Marketing` |
| `excludeAgencies` / `excludeTechCompanies` / `excludeRecruiters` / `excludeJuniorRoles` | Toggle built-in exclusions | `true` |
| `requireDemandSignal` | Only reach out with evidence of need | `true` |
| `bookingUrl` | CTA link in drafts | `https://cal.com/you/30min` |

Tips: keep roles specific, add your competitors, and start with one industry and one city so discovery stays cheap and precise.

## Email & sender inboxes (connect your team/business inboxes)

- **Sender inboxes** (sidebar) → **Connect a Gmail inbox** runs Google OAuth for each team or business inbox. Tokens are stored AES-256-GCM encrypted.
- Each inbox has its own **daily limit (default 1/day)**. Approved drafts are assigned **round-robin** across enabled inboxes under their limit, and you can see **sent today** per inbox.
- The global kill switch, the global daily cap, the suppression list and the compliance footer still apply to every send.
- **Warm-up**: start at 1/day per new inbox and raise slowly as you get replies.
- ⚠️ **Google sender guidelines**: only connect inboxes you own or are authorised to use. Spreading mail over many accounts to get around Gmail sending limits breaks Google's policies, and Google can **suspend every account involved**. Follow [Google's email sender guidelines](https://support.google.com/a/answer/81126).

With no sender inboxes connected, sends use the single Google connection from **Settings**.

## Compliance & Terms of Service

**You** are responsible for how you use this tool.

- **Cold email**: CAN-SPAM (US), GDPR/ePrivacy and PECR (EU/UK), CASL (Canada) and similar laws apply. Defaults: sender identity + `OUTREACH_SENDER_ADDRESS` + unsubscribe line in every email, `List-Unsubscribe` header, automatic suppression of opt-outs, conservative caps, approval queue, kill switch ON. Some regions (for example under GDPR) need a legitimate-interest assessment or consent before you email people.
- **Scraping**: only collect public business data you're allowed to process, and respect each site's terms and robots rules.
- **LinkedIn / X automation (optional, OFF)**: [LinkedIn's User Agreement](https://www.linkedin.com/legal/user-agreement) bans bots, scripts and browser automation for messaging and connection requests, and [X's Terms](https://x.com/en/tos) ban automating or scripting the site without permission. LinkedIn has taken legal action against automation and scraping tools. Turning on `ENABLE_SOCIAL_AUTOMATION=true` drives a signed-in browser and **can get your accounts restricted or banned**. Daily caps do not make it allowed. With the flag off (default), Home shows only the Email send card. LinkedIn connect, LinkedIn message, and X cards stay hidden, as do the LinkedIn Send and Chrome setup links. LinkedIn/X drafts are still created so you can send them **by hand**.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Can't reach database server` | `docker compose up -d`; use `127.0.0.1`, not `localhost`; check port 5432 is free |
| Prisma client errors after pulling | `npm run db:generate` (or `npm run setup`) |
| Unknown column `profileFitStatus` or `datasetImported` | `npm run db:push` so import can store Profile match and actor-run import state |
| AI shows heuristic mode | Set `OPENROUTER_API_KEY` or `OPENAI_API_KEY`, restart the dev server |
| OpenRouter `429` | Free-model rate limit. Wait, add credits, or change `AI_MODEL` |
| OpenRouter `402` | Negative balance or key credit limit. Check [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Apify "not connected" | Set `APIFY_TOKEN` or save it in **Connect → Apify** |
| No leads pass the filter | Loosen the Business Profile (more roles/industries, turn off `requireDemandSignal`) |
| Google Maps import keeps 0 leads | Place links (`google.com/maps`) are the source, not the company website. A full actor run stays in progress until it finishes; use **Sync results** on the actor page (or the queue worker) to import the dataset. Agencies and tech peers that match your exclusions are removed and counted separately from Profile matches |
| Nothing sends | Kill switch is ON by default. Also check the daily caps, sender inbox limits and suppression list |
| `SENDER_CAPS_REACHED` | All inboxes hit their daily limit. Wait until tomorrow (UTC) or raise a limit |
| Google OAuth `redirect_uri_mismatch` | Add `GOOGLE_REDIRECT_URI` to the OAuth client's authorised redirect URIs |
| Playwright browser missing | `npx playwright install chromium` (only needed for website browser research / optional module) |

## Development

```bash
npm test            # unit tests (node:test via tsx)
npx tsc --noEmit    # type check
npm run lint
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/architecture/overview.md](docs/architecture/overview.md).

## Contributing

Issues and PRs are welcome. Please:

- keep changes focused and add tests next to the code you change;
- never commit `.env*`, real lead data, logs, cookies or browser profiles;
- never add code that sends messages without the approval queue and kill switch.

## Support this project

- ⭐ Star the repo and share it.
- 💖 Sponsor on GitHub: [github.com/sponsors/AlizayAyesha](https://github.com/sponsors/AlizayAyesha)
- 🛠 Commercial support, custom setup, hosting or features: **Zar Labs**, [zarlabs.online](https://zarlabs.online)

## License

Copyright (c) 2026 Zar Labs ([zarlabs.online](https://zarlabs.online)).

Licensed under the **GNU Affero General Public License v3.0** (`AGPL-3.0-only`). See [LICENSE](LICENSE) and [NOTICE](NOTICE).

In short: you can use, study, modify and share this software. If you distribute it, **or run a modified version as a network service for others**, you must make your modified source code available under the AGPL to those users.

**Commercial licensing** (using it without the AGPL obligations): contact Zar Labs via [zarlabs.online](https://zarlabs.online).
