# Scripts

Small developer diagnostics. None of them send messages.

| Script | Purpose |
| --- | --- |
| `apify-smoke.ts` | Checks your `APIFY_TOKEN` against the Apify API |
| `smoke-pipeline.ts` | Runs the lead pipeline on a generic sample lead (`amina@example.com`) |
| `print-google-oauth-url.ts` | Prints the Google OAuth consent URL for local setup |
| `load-local-env.ts`, `register-server-only.cjs` | Helpers for running scripts with `tsx` |
| `require-script-send.ts` | Guard: any future send script must set `JARVIS_ALLOW_SCRIPT_SEND=1` |
| `crawl4ai_chrome.py` | Optional Crawl4AI website fetcher |

Run with `npx tsx scripts/<name>.ts`. Daily outreach happens in the app UI, behind the approval queue and kill switch.
