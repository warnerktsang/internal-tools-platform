# internal-tools-platform

A shared substrate for a portfolio of internal tools, plus three real apps built on it: a **KYC
review queue**, a **refunds dashboard**, and a **feature-flag admin panel**.

The three apps are not the point. The point is the layer beneath them — authorization with deny
rules, field-level masking with audited reveal, auditable state transitions, declarative
approval policies, idempotency, and a transactional outbox — written once, inherited by every
app, and structurally impossible for an app to bypass. The claim the repository exists to test:
**apps 4 through 13 are materially cheaper because they inherit a common substrate.**

That claim is measured, not asserted. See [Evidence](#evidence-what-did-each-app-cost).

---

## Try it: https://internal-tools-platform-warners-projects-19e96c15.vercel.app

A hosted deployment with the demo data already seeded — nothing to install. **There is no login
screen: pick a person from the *Acting as* dropdown in the header first**, or every screen will
tell you no principal is selected. Who to be, and what to do, is below:
[Who to log in as](#who-to-log-in-as) and
[Four workflows worth trying](#four-workflows-worth-trying).

Two things about the hosted copy specifically: every visitor shares one database, so approvals
get consumed and flags get ramped as people click (it is reset by
[`POST /api/demo/reseed`](#deploy-it-as-a-shared-staging-link)); and the data is fake, the
third-party providers are in-process fakes, and there is no authentication by design — the
principal switcher *is* the demo. Do not put anything real behind a link like this.

---

## Run it locally

Only needed to run the tests, inspect the database, or develop. You need **Node 20+**,
**pnpm 10+**, and **Docker** (only to run Postgres; there is a no-Docker fallback below).

<details>
<summary>Installing those from scratch — macOS</summary>

```bash
# Homebrew, if `brew -v` does not work
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Apple Silicon: add brew to this shell and future ones
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile && eval "$(/opt/homebrew/bin/brew shellenv)"

brew install git node@20
brew link --overwrite --force node@20
npm install -g pnpm

brew install --cask docker
open -a Docker      # wait until `docker info` succeeds
```
</details>

<details>
<summary>Installing those from scratch — Ubuntu / Debian</summary>

```bash
sudo apt-get update && sudo apt-get install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo npm install -g pnpm

sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER && newgrp docker      # then `docker info` should succeed
```
</details>

```bash
git clone https://github.com/warnerktsang/internal-tools-platform.git
cd internal-tools-platform

cp .env.example .env      # local-only values; nothing in here is a real secret
pnpm install              # ~1-2 min, also runs `prisma generate`
pnpm db:up                # Postgres 16 in Docker on localhost:5433
pnpm db:migrate:deploy    # schema, indexes, and the two integrity triggers
pnpm db:seed              # 11 people, 4 payments, 4 refunds, 4 KYC cases, 5 flag configs
pnpm dev
```

Open **http://localhost:3000**. There is no login screen — pick a person from the dropdown in
the header (see [Who to log in as](#who-to-log-in-as)).

### Verification

```bash
pnpm test            # 165 tests, run against the real database
pnpm audit:verify    # walks the audit hash chain and reports the first break
pnpm typecheck && pnpm lint && pnpm build
```

> **`pnpm test` truncates the tables.** Run `pnpm db:seed` again before clicking through the UI.

### If you would rather not install Docker

```bash
# macOS
brew install postgresql@16 && brew services start postgresql@16
createuser -s itp && createdb -O itp itp
```

A local Postgres listens on **5432**, so edit `.env` to
`DATABASE_URL="postgresql://itp:itp@localhost:5432/itp?schema=public"`, then run
`pnpm db:migrate:deploy && pnpm db:seed && pnpm dev` and skip `pnpm db:up`.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `port 5433 already allocated` | Something else owns 5433. Change it in `docker-compose.yml` **and** `.env`. |
| `Can't reach database server` | Docker isn't ready. `docker compose ps` should show `itp-postgres` as healthy. |
| Stale UI after switching branches | `rm -rf .next && pnpm dev` |
| Want a clean slate | `docker compose down -v && pnpm db:up && pnpm db:migrate:deploy && pnpm db:seed` |

---

## Deploy it as a shared staging link

`vercel.json` sets the build command (`prisma migrate deploy && next build`), so a hosted demo is
a managed Postgres plus two environment variables. Roughly ten minutes, no code changes.

1. **Database.** Create a project in [Neon](https://neon.tech) (or Vercel Postgres) and copy the
   connection string. Take the **direct** (non-pooled) one — Prisma runs interactive transactions
   and `migrate deploy`, and demo traffic does not need a pooler.
2. **Project.** In Vercel, *Add New → Project*, import this repository. `main` is the production
   branch, and framework detection needs no changes: `vercel.json` supplies the build command and
   `prisma generate` already runs from `postinstall`. If the link is for other people, turn
   *Settings → Deployment Protection → Vercel Authentication* **off**, or they will be asked to
   log in to Vercel instead of seeing the app.
3. **Environment.** Add `DATABASE_URL` and `ADMIN_TOKEN` (any long random string) for all
   environments. Nothing else — the principal switcher is a cookie, not a session secret.
4. **Deploy.** The build runs the migrations, so the schema is live before the first request.
5. **Seed once** — this is what creates the data, not just a reset: the build gives the database
   its schema, this gives it its contents. Call the reseed route with the token you just set:
   `curl -X POST "https://<your-app>.vercel.app/api/demo/reseed?token=$ADMIN_TOKEN"`. It runs the
   same seed the CLI does — through real operations — so it also proves the deployed schema and
   audit triggers work. `DATABASE_URL='<the string>' pnpm db:seed` from a local checkout does the
   same thing.
6. Open the URL and pick a person. Actions settle within the request, so there is nothing to run
   by hand.

Two operational routes exist for a hosted demo, and both refuse to run unless `ADMIN_TOKEN` (or
Vercel Cron's `CRON_SECRET`) is configured and presented as a bearer token or `?token=`:

| Route | What it does |
| --- | --- |
| `POST /api/demo/reseed` | Wipes and rebuilds the demo — use it whenever visitors have drifted the shared state. |
| `GET /api/effects/sweep` | Runs `runEffects()`. Nothing calls it on a schedule; it exists to recover an outbox row whose process died between the commit and the provider call, which is the one state the request path cannot settle itself. A production deployment would put this on a cron or a queue consumer. |

Two things to know before sharing the link:

- **Visitors share one mutable database.** Approvals get consumed and flags get ramped; reseed
  when the demo has drifted.
- **Anyone can be anyone.** The switcher is the point, and the data is fake. The identity seam
  refuses to authenticate as a system principal, so a hand-written cookie cannot borrow the
  permissions the system actors hold — but there is no authentication on the app itself, and
  there is not meant to be. Do not put anything real behind this link.

---

## Who to log in as

The header dropdown is the demo stand-in for SSO. **Switching people is how you exercise
separation of duties** — no policy in this repo can be satisfied by one person acting alone.

| Person | Role | Scope |
|---|---|---|
| Sofia | support agent | Consumer |
| Dan | support agent | SMB |
| Priya | finance manager | Consumer |
| Nadia, Lea | KYC analysts | Consumer |
| Raj | KYC analyst | SMB |
| Omar | compliance officer | all business units |
| Sam | engineer | `development`, `staging` only |
| Renee, Mira | release managers | including `production` |
| Ava | auditor | read-only, everywhere |

Roles and deny rules live in [`src/config/roles.ts`](src/config/roles.ts) — versioned and
reviewable in a pull request, rather than edited by hand in a production admin UI.

## Four workflows worth trying

Each one is interesting because of how it *refuses*.

**1. KYC — masking and audited reveal.** As **Nadia**, open a Consumer case → **Claim** →
**Reveal SSN**. The SSN is masked on the server, so the browser never receives it until the
reveal is authorized, and the reveal is written to the trail as its own event. Now switch to
**Ava** and append `?reveal=ssn` to the URL: still masked, and nothing is logged, because no
reveal happened. Switch to **Raj** (SMB) and open the same case: denied — and the denial is
recorded.

**2. KYC — separation of duties.** As **Nadia**, **Reject** a case with a reason: the case moves
to **Awaiting approval**, and Nadia is offered no approve control on her own request. Switch to
**Omar**, approve, and the reason Nadia wrote is what applies. Then as **Lea**, open the case
Nadia claimed — her controls are disabled, because she does not hold it.

**3. Refunds — money invariants and an honest "unknown".** As **Sofia**, refund more than the
payment's remaining refundable amount: refused as *invalid* with a reason, not a 500. Refund
above the approval threshold: parks for **Priya**. One seeded refund sits in `unknown` because
the fake processor timed out — the system refuses to guess whether the customer was paid, and
offers reconciliation instead.

**4. Flags — environment scope and concurrency.** As **Sam**, ramp `checkout_v2` in staging;
production is not available to him at all. As **Renee**, ramp production 10% → 40%: parks for a
*second* release manager (**Mira** approves; Renee cannot approve her own). Try ramping *down*:
refused — "a rollout only ramps up… use the rollback action". **Rollback** requires no approval,
deliberately, because requiring sign-off to stop an incident makes outages longer. Set staging
to **66%** to watch a publish fail: the saved version advances but the **live** version stays
behind, and the UI says so instead of claiming the new value is live.

Then open **`/audit`**: one hash-chained trail across all three apps, covering reads, denials,
decisions and approvals, with verification.

---

## Architecture

Two kinds of code, and the boundary between them is the whole repository:

- `src/substrate/` — identity, policy engine, field policy/`project()`, audit chain,
  transitions, approvals, idempotency, effects, registry and generated views. **No app
  knowledge.**
- `src/apps/{refunds,kyc,flags}/` — declarations: state machines, domain guards, approval
  policies, fake external providers, and the one or two custom panels each app needs. **No
  authorization or audit logic of their own.**

```mermaid
flowchart TB
  UI["Generated screens + a few app panels"] --> EX["execute()"]
  EX --> ID["idempotency"]
  ID --> AZ["authorize: permission → scope → deny-last"]
  AZ --> LK["lock row, check state"]
  LK --> GD["app domain guard"]
  GD --> AP["approval policy?"]
  AP -->|parks| PR["approval_requests (payload + baseline)"]
  AP -->|proceeds| TX["one transaction: state + audit row + effect intent"]
  PR -->|second person approves| TX
  TX --> WK["effect run inline, after commit"]
  WK --> PT["typed port: fake Stripe / flag service / doc store"]
  PT --> EX
```

Five properties are worth calling out, because they are the ones that make this different from a
generated CRUD app that merely looks similar in a screenshot:

1. **Read is a first-class operation.** Lists, details and reveals are authorized, projected and
   audited on the same path as writes. "Who viewed this SSN" is answerable.
2. **Deny rules are evaluated last** and override grants held via any other role.
3. **`project()` is the only serializer.** Masking happens in a server component; the client
   never receives a value it is not allowed to see, so masking cannot be undone with CSS.
4. **One transaction per write.** State change and audit row commit together, enforced by a
   Postgres trigger — writing domain state without an audit row fails at the database, so "no
   writes outside the transition layer" is a guarantee rather than a convention.
5. **External calls happen outside the transaction**, via a transactional outbox: intent commits
   with the state change, then `execute()` calls the port — after commit, before it returns —
   with an idempotency key, and the outcome re-enters `execute()` as a new operation under a
   system principal. A timeout is `unknown`, never silently `failed`. The queue exists for
   ordering and replay safety, not to defer the work: the caller waits for the outcome.

Every operation returns one of five statuses that never collapse into a single red toast:
`ok` · `pending` · `denied` · `invalid` · `unknown`. An authority violation, a fat-fingered
amount, and a processor timeout are three different things and the UI says so.

### What each app had to write for itself

The substrate provides the *place* to run a domain rule and the guarantee that it runs inside the
transaction. It never pretends to know the rule.

| App | Its own irreducible logic |
|---|---|
| Refunds | integer minor units, cumulative-refund invariant, timeout ≠ failure, out-of-order webhooks |
| KYC | which fields are PII, holder exclusivity, evidence-before-approval, risk thresholds |
| Flags | environment scope, monotonic rollout, reviewed-baseline concurrency, saved-vs-live publish state |

---

## Evidence: what did each app cost?

All six pull requests were built in one Devin session, in strict order, on the same substrate —
so the marginal cost of an app is a diff, not an estimate.

| PR | | App code | Substrate code | Tests |
|---|---|---|---|---|
| #1 | substrate-core (identity, policy, field policy, audit chain) | — | +897 | +819 |
| #2 | substrate-operations (transitions, approvals, idempotency, outbox) | — | +860 | +591 |
| #3 | substrate-registry-ui (registry, generated screens, shell) | — | +372 | +361 |
| #4 | **app-refunds** | +610 | +224 / −19 | +533 |
| #5 | **app-kyc** | +367 | +27 / −1 | +389 |
| #6 | **app-flags** | +454 | **0** | +436 |

**Substrate change required per app: 224 → 27 → 0.**

- Refunds, as app #1, still finished the platform: it needed `retryable` on port outcomes.
- KYC needed 27 lines — an advisory `availableWhen` hook on transitions, added because browser
  testing found the UI offering controls the server would refuse.
- Flags needed **zero**, and it was the app most likely to break the design: it scopes by
  `environment` where the others scope by business unit, its approval turns on the *proposed*
  payload rather than the stored row, and its correctness problem is optimistic concurrency
  rather than money. It got all of that by declaring
  `scope: { dimension: 'environment', field: 'environment' }`.

Roughly 2,360 lines of substrate and 1,780 lines of substrate tests carry three apps of ~360–610
lines each. Every app's own tests exercise the real database, the real policy engine, and the
real approval and effect paths — nothing is mocked except the third-party providers.

---

## Compared with Power Apps

| Power Apps capability | Here |
|---|---|
| UI generated from a data model | `registerResource()` generates list / detail / history / action screens from a resource declaration |
| Connectors to external systems | Typed ports with an outbox, idempotency keys and explicit `unknown` outcomes |
| Role-based security | Deny-last policy engine with named scope dimensions, evaluated server-side; roles are code |
| Dataverse audit | Hash-chained audit of reads, writes, denials and approvals, verifiable via `pnpm audit:verify` |
| Approval flows | Declarative policies with separation of duties (`excludeRequester`) and reviewed-baseline replay |
| **Authoring by non-engineers** | **Not replicated.** There is no drag-drop designer. |
| Managed hosting / licensing | Your own Next.js app and Postgres; no per-user licensing |

The honest version of the trade: this replaces the governance, integration and audit story that
Power Apps charges for, with code you own. It does **not** replace a canvas designer that lets a
business analyst ship an app with no engineer in the loop. What it substitutes for that is the
way this repository was built — every app here arrived as a reviewed pull request with tests and
a browser-validated walkthrough, authored by an agent from a natural-language description.

---

## Limitations and known abstraction leaks

Stated plainly, because a prototype that hides these is not useful for a build decision.

- **Everything third-party is a deterministic in-process fake** — no Stripe, no flag service, no
  document store, no network calls, no credentials. The fakes are deliberately *adversarial*
  (duplicate webhooks, out-of-order delivery, timeouts with unknown outcome, injected publish
  failures) because a fake that always returns 200 deletes the hard part. Swapping in a real
  provider means implementing one port.
- **`invalid` domain refusals are not audited.** Nothing was written, so it is defensible, but
  repeatedly poking at a case you should not touch currently leaves no trace.
- **Authentication is a signed cookie from a dropdown.** Real SSO/OIDC is a port, not a rewrite,
  but it is not built.
- **`66%` is unusable as a real staging rollout value**, because the fake flag service is
  scripted to reject it so that `publish_failed` is reachable in a demo.
- **The `denied` banner is unreachable inside flags** — cross-environment access fails at read
  time and renders the access-denied page instead, so only `ok`/`pending`/`invalid` are
  demonstrable there.
- **`/audit` fetches the most recent 100 events** with no filtering or pagination.
- **`lockAndLoad` interpolates a table name** into `FOR UPDATE` SQL. Safe today because table
  names are literals in resource definitions; it should be identifier-validated in
  `defineResource()`.
- **No vendor-access app.** It was scoped as the extension point for measuring app #4 and
  deliberately not built.
- Two authorization-UI defects in this repo were caught by driving the browser, not by the unit
  tests: approval denials rendering silently, and controls being offered to principals the server
  would refuse. Both are fixed; the lesson is that the validation loop is part of the operating
  model.
