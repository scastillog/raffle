# Rifa

Raffle website: numbers **000–999**, each ticket costs **25.000 COP** and gets **2 numbers**, prize **1.000.000 COP**.
The winner is the **last 3 digits of the Lotería de Boyacá** main prize on the draw date.

- `/` – public page (Spanish): pick numbers, reserve, get payment instructions.
- `/admin.html` – admin page: confirm payments, cancel tickets, register the lottery result.

## How it works

1. The buyer picks their numbers in one of 3 ways:
   - **Elijo los 2** – picks any 2 free numbers.
   - **Elijo 1 y me dan su pareja** – picks 1 number and also gets the number +500 (123 ↔ 623).
   - **Al azar** – the system assigns 2 random free numbers.
2. The buyer enters **name + phone** and reserves. The numbers are held for `reservation_hours` (default 24h).
3. The buyer pays by Nequi/transfer (instructions come from `payment_instructions`) and sends proof on WhatsApp.
4. The admin presses **Confirmar pago** in `/admin.html`, which marks the ticket and numbers as sold.
   Unpaid reservations expire on their own and the numbers become available again.
5. After the draw, the admin enters the Lotería de Boyacá number. The last 3 digits decide the winner,
   ticket sales close, and the public page shows the result.

## Technology

| Layer | What we use |
|---|---|
| Frontend | Plain HTML + CSS + vanilla JavaScript (no framework, no build step) |
| Hosting | **S3** (private bucket) served through **CloudFront** (Origin Access Control, HTTPS) |
| API | **API Gateway HTTP API** behind CloudFront on `/api/*` → **AWS Lambda** (Node.js 22, ARM64) |
| Database | **DynamoDB** (on-demand), 3 tables: `numeros`, `boletos`, `ajustes` |
| Secrets | **SSM Parameter Store** (SecureString) for the admin password and token-signing key |
| Infrastructure | **Terraform** (AWS provider) |
| Tests | Node built-in test runner (`node --test`) |

No double-selling: each reservation is a DynamoDB **transaction** that only succeeds if both numbers are
free (or held by an expired reservation), so two people can never get the same number.

Admin login: the password is checked by the Lambda, which returns a signed session token (12h).
API Gateway throttling limits brute-force attempts.

## Project layout

```
frontend/   index.html, app.js (public) · admin.html, admin.js (admin) · styles.css
backend/    src/index.mjs (router) · src/service.mjs (DynamoDB) · src/raffle.mjs (rules) · src/auth.mjs
infra/      Terraform: dynamodb, lambda, api, frontend (S3 + CloudFront), secrets
```

## Deploy

Requirements: Terraform ≥ 1.6, AWS credentials (`aws configure` or env vars), Node 22 only for tests.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # fill in draw date, payment info, WhatsApp, admin password
terraform init
terraform apply
```

Outputs: `site_url` (public page) and `admin_url`. The first CloudFront deployment takes a few minutes.

To change texts, prices or code, edit the files and run `terraform apply` again. HTML/JS/CSS are served with
`Cache-Control: no-cache`, so changes are visible right away.

## Tests

```bash
cd backend && npm test
```

## Notes

- `terraform.tfvars` and the Terraform state hold the admin password: don't commit them (already in `.gitignore`).
  For a shared setup, enable the S3 backend in `infra/versions.tf`.
- Public raffles in Colombia are regulated by **Coljuegos**; check whether you need a permit.
