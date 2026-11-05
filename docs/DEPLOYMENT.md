# Deploy, migrate, roll back

This release does not deploy, migrate production, change DNS, or turn off the kill switch.

## Apply on a non-production database first

1. Take a backup.
2. Set the new environment variables below. Do not print the values.
3. Apply `prisma/sql/20261106120000_jarvis_product_completion.sql` or run `npx prisma db push` against that database.
4. If stored credentials were encrypted with the old fallback, set `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` to that exact previous material, run `npx tsx scripts/rotate-credentials.ts`, review the dry-run counts, then re-run with `--apply`. Unreadable rows are not deleted. Remove `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` after a successful rewrite.
5. Run one worker: `npm run worker`. Point cron at `POST /api/v1/worker/tick` with `QUEUE_PROCESS_SECRET` if you do not want a long-running process. Do not use GET.
6. Keep `sendsPaused=true` and `sendMode=draft_only` until sender address, unsubscribe secret, https `APP_URL`, and a real Gmail mailbox are in place.

## Required before production sign-in

| Name | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` or `AUTH_JWT_ISSUER` | Supabase issuer, normally `https://<project>.supabase.co/auth/v1` |
| `AUTH_JWT_AUDIENCE` | Default `authenticated` |
| `SUPABASE_JWT_SECRET` | Only if the project still signs HS256 access tokens |
| `JARVIS_SESSION_SECRET` | 32+ characters. Signs the HttpOnly Jarvis cookie |
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte key for stored provider tokens |
| `DATABASE_URL` and `DIRECT_URL` | Postgres |
| `QUEUE_PROCESS_SECRET` | Worker endpoint. Required in production |
| `UNSUBSCRIBE_TOKEN_SECRET` | Signs one-click unsubscribe links |
| `OUTREACH_SENDER_ADDRESS` | Real postal address. The example placeholder blocks sends |
| `APP_URL` | Public https origin. Required for one-click List-Unsubscribe |
| `JARVIS_DEFAULT_TENANT_ID` | Optional. Default `tenant_zar_labs` |

Optional and unset means the feature stays off:

| Name | Purpose |
| --- | --- |
| `EMAIL_EVENT_WEBHOOK_SECRET` | HMAC for bounce and unsubscribe webhooks |
| `GMAIL_REPLY_POLL` | `true` lets `POST /api/queue/process` read Gmail for replies and bounces |
| `ENABLE_SOCIAL_AUTOMATION` | LinkedIn and X. Default off |
| `JARVIS_BOOTSTRAP_TENANT` and `JARVIS_BOOTSTRAP_ADMIN_EMAILS` | First admin attachment when `app_metadata.tenant_id` is absent |
| `BILLING_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` | Recorded as absent or present. This release still does not charge |

Gmail OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) is the existing mailbox connection. It authenticates that Google account. It does not publish SPF, DKIM, or DMARC and it does not authenticate a different From domain.

## Roll back

1. Stop the worker and remove the cron POST.
2. Leave `sendsPaused` true.
3. Deploy the previous build.
4. New columns and tables are unused by the old build and can stay. Do not drop them in the rollback; dropping them deletes memberships and the usage ledger.
5. If credential rows were rewritten, keep the new `CREDENTIAL_ENCRYPTION_KEY`. The old build cannot read them if it still derives a key from `DATABASE_URL`.
