# Jarvis service contract v1

Jarvis (`leads-marketing-tool`) is the outreach service. Zar Labs (`https://github.com/AlizayAyesha/Zar-Labs`, site `https://zarlabs.online`) is the control plane and the only login. This repository was not able to read that private repo. The live site signs operators in at `/dashboard/login` with Google or email/password, and the public pages already call `*.supabase.co` (project host observed in public media URLs: `aaptopqqtxhbujbxgtzy.supabase.co`). Confirm that host is still the auth project before production. Do not hardcode a second user database.

The combined product is **not** complete until Zar Labs calls this contract and both sides are tested together. Socioi is unrelated. The removed AI Ads Engine is not part of this service.

## Identity

Jarvis verifies Supabase access tokens. It does not accept a user id, email, or tenant from a request body or from `user_metadata`.

| Check | Rule |
| --- | --- |
| Issuer | `AUTH_JWT_ISSUER`, or `NEXT_PUBLIC_SUPABASE_URL` + `/auth/v1` |
| Audience | `AUTH_JWT_AUDIENCE`, default `authenticated` |
| Signature | ES256, RS256, or EdDSA via `{issuer}/.well-known/jwks.json`. HS256 only with `SUPABASE_JWT_SECRET`. `alg=none` is rejected. |
| Subject | `sub` is the Supabase user id |
| Email | `email` claim, stored for display |
| Tenant | `app_metadata.tenant_id` only, else a `Membership` row, else `JARVIS_BOOTSTRAP_TENANT=true` and an email listed in `JARVIS_BOOTSTRAP_ADMIN_EMAILS` |
| Role | `app_metadata.role` of `ADMIN` or else `OPERATOR`. Never `user_metadata.role`. |

Anon key and service role key do not authenticate a request. The service role key is never sent to the browser.

### Session exchange

`POST /api/v1/auth/session`

Request headers: `Authorization: Bearer <supabase access token>`

Response `200`:

```json
{
  "contractVersion": "1",
  "principal": { "sub": "user-uuid", "email": "owner@example.com", "role": "ADMIN", "tenantId": "tenant_zar_labs", "source": "bearer", "scope": "tenant" }
}
```

Also sets `Set-Cookie: jarvis_session=...; HttpOnly; SameSite=Lax`. The cookie is an HS256 JWT (`iss=jarvis`, `aud=jarvis-session`) signed with `JARVIS_SESSION_SECRET` (32+ characters). It is minted only after the Supabase token verifies.

`GET /api/v1/auth/session` returns the same principal or `401`.

`DELETE /api/v1/auth/session` clears the cookie.

Later calls may send either the Supabase bearer token or the cookie. API calls from `zarlabs.online` should send the bearer token. The cookie is for the Jarvis origin after the exchange.

### Errors

```json
{ "error": { "code": "UNAUTHENTICATED", "message": "..." } }
```

| HTTP | code |
| --- | --- |
| 401 | `UNAUTHENTICATED`, `INVALID_TOKEN` |
| 403 | `TENANT_UNASSIGNED`, `FORBIDDEN` |
| 503 | `AUTH_NOT_CONFIGURED` |

`POST /api/v1/auth/dev-session` exists only when `NODE_ENV` is not `production` and `DEV_AUTH_ENABLED=true`. It returns 404 in production. It is not a second account system.

## Routes

Base path `/api/v1`. Authenticated routes require the bearer token or session cookie. Tenant filters apply to leads, drafts, events, sequences, tasks, Gmail connections, AI credentials, sender accounts, usage, and tenant settings. Opt-outs in `Suppression` are deployment-wide so a second tenant cannot email an address that already opted out.

| Method | Path | Auth | Effect |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | public | No secrets. Does not send. |
| POST | `/api/v1/auth/session` | Supabase bearer | Mints the Jarvis cookie |
| GET | `/api/v1/operator/summary` | user | Policy, usage, sender, billing. Does not send. |
| GET | `/api/v1/outreach/policy` | user | Read-only. Does not send. |
| GET | `/api/v1/leads` | user | Tenant-scoped lead list |
| POST | `/api/v1/outreach/drafts/:id/approve` | user | Approves. Sends only when mode is `send_on_approve` or `auto` and the kill switch, quota, suppression, bounce, and sender checks pass. Default mode is `draft_only` and `sendsPaused` is true. |
| POST | `/api/v1/outreach/drafts/:id/reject` | user | Rejects. Does not send. |
| GET | `/api/v1/usage` | user | Ledger counts |
| GET | `/api/v1/billing` | user | `chargesEnabled` is always false in this release |
| GET | `/api/v1/sending/readiness` | user | Sender problems and DNS status `not_checked` |
| POST | `/api/v1/sending/dns` | user | Live TXT lookup. Does not edit DNS. |
| GET | `/api/v1/worker/tick` | none | 405. Does not send. |
| POST | `/api/v1/worker/tick` | `QUEUE_PROCESS_SECRET` or `CRON_SECRET` via `x-queue-secret` or `Authorization: Bearer` | Claims due tasks and sequence steps. Does not call Gmail or LinkedIn/X. |
| POST | `/api/queue/process` | same worker secret | Same queue, plus Gmail reply polling only when `GMAIL_REPLY_POLL=true`, plus social workers only when `ENABLE_SOCIAL_AUTOMATION=true`. |
| GET | `/api/queue/process` | user or worker secret | Counts only. Does not claim or send. |
| POST | `/api/v1/webhooks/email-events` | `EMAIL_EVENT_WEBHOOK_SECRET` HMAC | Bounce, unsubscribe, or reply |
| GET | `/api/v1/unsubscribe?token=` | signed token | Confirmation page. Does not unsubscribe. |
| POST | `/api/v1/unsubscribe?token=` | signed token | One-click or form unsubscribe |

Worker secret comparison is timing-safe. In production the queue routes reject requests when the secret is unset. Loopback without a secret is development-only.

### Webhook body

Header: `x-jarvis-signature: sha256=<hex hmac of the raw body>`

```json
{ "provider": "gmail", "providerEventId": "evt_1", "type": "bounce", "email": "a@b.c", "leadId": "uuid", "draftId": "uuid", "text": "optional reply text" }
```

`provider` + `providerEventId` is unique. A retry returns `duplicate: true` and does not send another message or add a second suppression row.

### Unsubscribe token

HMAC SHA256 over a base64url JSON payload `{ v, email, leadId, tenantId, exp }`, key `UNSUBSCRIBE_TOKEN_SECRET` (16+ characters). List-Unsubscribe includes that https URL when `APP_URL` is https, plus mailto, plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.

### Mocked dashboard call

```ts
const response = await fetch(`${JARVIS_ORIGIN}/api/v1/auth/session`, {
  method: "POST",
  headers: { authorization: `Bearer ${supabaseAccessToken}` },
});
const { principal } = await response.json();
await fetch(`${JARVIS_ORIGIN}/api/v1/outreach/drafts/${draftId}/approve`, {
  method: "POST",
  headers: { authorization: `Bearer ${supabaseAccessToken}` },
});
```

`supabaseAccessToken` is the session from `supabase.auth.getSession()` on zarlabs.online. Do not forward the service role key.

## Sending rules

Immediately before Gmail is called, Jarvis re-reads pause, send mode, approval, suppression, bounce, sequence state, daily quota, sender address, and unsubscribe configuration. A crash after Gmail accepts a message is reconciled from the `SENT` event. A crash before acceptance releases the `pending:` claim after two minutes. Two workers cannot both move the same task to `RUNNING`; the lease is an atomic `updateMany`. Expired leases are retried with backoff up to 15 minutes, then failed. The worker process is `npm run worker`. Operators do not click `/api/queue/process`.

Social automation stays off unless `ENABLE_SOCIAL_AUTOMATION=true`. The historical invite-wave size is not permission to invite anyone.

## Billing

`chargesEnabled` is false even if `STRIPE_SECRET_KEY` is present. No prices were invented and no charge API is called. Usage rows live in `UsageEntry`. The daily cap remains the existing outreach limit.

## Encryption

`CREDENTIAL_ENCRYPTION_KEY` must be 32 bytes (64 hex characters or standard base64). `DATABASE_URL` and the old fixed string are rejected. Set `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` only while re-reading old ciphertext, then run `npx tsx scripts/rotate-credentials.ts` (dry run) and `--apply` when ready. Rows that do not decrypt are left in place.
