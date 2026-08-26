# internal-tools-platform

A shared substrate for a portfolio of internal tools, plus three apps built on it: a KYC
review queue, a refunds dashboard, and a feature-flag admin panel.

The interesting part is not the three apps. It is the layer beneath them: authorization
with deny rules, field-level masking with audited reveal, auditable state transitions,
declarative approval policies, idempotency, and a transactional outbox — built once,
shared by every app, and structurally impossible for an app to bypass.

## Run it locally

Requires Node 20+, pnpm 10+, and Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up              # Postgres 16 on localhost:5433
pnpm db:migrate         # schema + integrity triggers
pnpm dev                # http://localhost:3000
```

Verification:

```bash
pnpm test               # unit + integration tests (needs the database running)
pnpm typecheck
pnpm lint
pnpm audit:verify       # walks the audit hash chain and reports the first break
```

Seeded demo identities, demo data, and a click-through walkthrough of each app arrive with
the apps themselves; this section is kept current as they land.

## Architecture

Two kinds of code, and the boundary is the whole point of the repository:

- `src/substrate/` — identity, policy engine, field policy/`project()`, audit chain, and
  (in later changes) transitions, approvals, idempotency, effects. No app knowledge.
- `src/config/` — app *declarations*: the role catalog and deny rules, versioned and
  reviewable in a pull request rather than edited in a production admin UI.
- `src/app/` — the three apps, which declare their resources, guards and policies and own
  no authorization or audit logic of their own.

An honest account of what this prototype proves and what it does not is written up as the
apps land.
