# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Rifa" — a numbers raffle site (000–999). Each ticket costs 25.000 COP and gets 2 numbers; the winner
is decided by the last 3 digits of the Lotería de Boyacá draw. Public page to reserve numbers, admin
page to confirm payments/cancel tickets/register the result. All user-facing text is in Spanish.

## Commands

```bash
cd backend && npm test          # run all backend tests (node --test test/*.test.mjs)
node --test test/raffle.test.mjs -t "some test name"   # run a single test (from backend/)
```

No build step anywhere: the frontend is plain HTML/CSS/vanilla JS, and the backend Lambda runs on the
`nodejs22.x` AWS SDK v3 already bundled in the runtime, so neither has dependencies to install.

Infra (from `infra/`):

```bash
cp terraform.tfvars.example terraform.tfvars   # fill in draw date, payment info, WhatsApp, admin password
terraform init
terraform apply
```

## Architecture

**Backend (`backend/src/`)** — a single Lambda behind API Gateway HTTP API, routed by hand in
`index.mjs`:
- `raffle.mjs` — pure domain rules (number selection, phone/name validation, ticket status, winner
  computation). No AWS calls; this is what the unit tests in `backend/test/raffle.test.mjs` exercise.
- `service.mjs` — all DynamoDB access and the three use-case flows: create/confirm/cancel ticket,
  declare/clear winner, public state. Talks to 3 tables (set via env vars `NUMBERS_TABLE`,
  `TICKETS_TABLE`, `SETTINGS_TABLE`).
- `auth.mjs` — stateless signed admin session tokens (`base64url(payload).base64url(hmac-sha256)`),
  no server-side session store.
- `index.mjs` — request router + JSON responses + error mapping. Admin password and the
  token-signing secret are loaded from SSM Parameter Store once per container and cached in a
  module-level `secrets` variable.

**Concurrency-safety is the core invariant**: reserving a ticket is a single DynamoDB
`TransactWriteCommand` that puts both number rows and the ticket row together, conditioned on each
number being free (never used, or a previously *reserved* row whose `expiresAt` has passed). This is
what guarantees two buyers can never get the same number — don't bypass it with separate
read-then-write calls when touching `createTicket`/`confirmTicket`/`cancelTicket`.

Ticket/number status lifecycle: `pendiente` (reserved, unpaid) → `pagado` (admin confirmed) or
`cancelado`/expired (`vencido`, computed on read from `expiresAt`, not stored). Numbers are only ever
released back to the pool when a ticket is cancelled or its reservation expires.

**Frontend (`frontend/`)** — no framework, no build: `index.html`/`app.js` is the public page (3
selection modes: `libre` pick 2, `pareja` pick 1 get its pair at `+500 mod 1000`, `azar` random);
`admin.html`/`admin.js` is the admin page (login, confirm/cancel, declare winner). Both talk directly
to `/api/*`. `intro.js`/`intro.css` is the pixel-art intro overlay on the public page (canvas sprites
defined as string grids, typewriter text, pixel-dissolve exit); shown once per browser session
(`sessionStorage`), replayable from the hero link. The message text is at the top of `intro.js`.

**Infra (`infra/*.tf`)** — Terraform, one file per concern: `dynamodb.tf` (3 on-demand tables),
`lambda.tf`, `api.tf` (API Gateway HTTP API), `frontend.tf` (S3 + CloudFront with OAC, HTML/JS/CSS
served with `Cache-Control: no-cache` so edits are visible immediately after `terraform apply`),
`secrets.tf` (SSM SecureString params for admin password + token secret, plus the CloudFront→API
`X-Origin-Verify` secret the Lambda checks). `POST /api/boletos` has its own API Gateway throttle
(`purchase_rate_limit`/`purchase_burst_limit`, shared by all buyers) to slow purchase-code guessing. AWS profile comes from `var.aws_profile` (null = default credential chain). State is local by default;
S3 backend is commented out in `versions.tf` for shared setups. Raffle parameters (price, prize, draw
date, payment instructions, WhatsApp number, reservation window) are all Terraform variables, not
hardcoded, and flow into the Lambda as env vars.

## Notes

- `terraform.tfvars` and Terraform state contain the admin password — never commit them (already
  gitignored).
- Public raffles in Colombia are regulated by Coljuegos; permit requirements are a product question,
  not something to assume away in code.
