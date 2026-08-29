---
name: testing-refunds-substrate
description: How to run and end-to-end test the internal-tools-platform substrate apps (refunds, KYC review queue) locally in the browser — environment startup, principal switching, reaching each operation status, PII masking/reveal checks, and known UI gaps.
---

# Testing the internal-tools-platform (substrate + refunds app)

## Bring the app up
```bash
export PATH=~/.npm-global/bin:$PATH   # pnpm is NOT on the default PATH in one-shot shells
pnpm install                          # if node_modules missing
pnpm db:up                            # docker Postgres, host port 5433
pnpm db:migrate:deploy
pnpm db:seed                          # wipes + rebuilds domain data through real operations
pnpm dev                              # http://localhost:3000
```
After any machine/container restart, re-run `db:seed` — record IDs are cuids and change every seed,
so never hardcode refund IDs; get them from the list pages (`/r/refunds`, `/r/payments`).

## Acting as different people
There is no login. The sidebar has an "Acting as" context switcher (a `<select>` that submits on
change) which sets a signed cookie. A fresh browser profile shows "No principal selected" — pick
someone first.
Seeded principals: Sofia Ramos (support_agent, bu-consumer), Nadia Haddad (kyc_analyst,
bu-consumer), Sam Okafor (engineer, development+staging), Omar Diallo (compliance_officer +
finance_manager + release_manager — the second signer for every flow, and the only principal who
may change production flags), Ava Chen (auditor, global read). System principals
`sys-refund-settler` and `sys-flag-publisher` perform outbox effects.
Because Omar is the only release_manager, a production ramp above 25% parks and can never be
approved — that is a property of the small demo cast, not a bug. Countersigning is demoable in
refunds (Sofia → Omar) and KYC (Nadia → Omar).

## Reaching each behaviour through the UI
- Draft a refund: payment detail (`/r/payments/<id>`) → "Request a refund" panel (Amount, Reason,
  **Draft refund**).
- Approval threshold is `> 10000` minor units ($100.00). Over-threshold `submit` returns `pending`
  and leaves state `draft`; an approver must use the "Awaiting approval" card.
- Effects are NOT background: every record detail page has a **Run effect worker** button that drains
  the outbox. Use it instead of shelling out.
- Deterministic fake processor (`src/apps/refunds/processor.ts`): minor amount ending in `13` → timeout →
  state `unknown` (reconcilable, truth is "succeeded"); ending in `07` → hard decline → state `failed`;
  anything else → `succeeded`. So $40.13 and $40.07 are the cheap ways to exercise unknown vs failed.
- `reconcile` is only enabled while state is `unknown` and only for `finance_manager`.
- Scope isolation: as Sofia, `/r/payments/pay-smb-1` (or `/r/kyc-cases/kyc-4`, both bu-smb) renders an "Access denied" card; list headers show
  "N visible · scoped to business_unit …" and N must equal the rendered row count.
- Audit: `/audit` (any principal, meaningful as Ava) shows a "verified · N events" hash-chain badge plus
  every write/decision/auth_denied event.

## Operation statuses and how to make each one render
The single `OperationBanner` reads `?status=<ok|pending|denied|invalid|unknown>&message=…`:
- `ok` (green "Applied") — any successful action, e.g. **Draft refund**.
- `pending` (amber "Awaiting approval") — submit above the $100 threshold.
- `invalid` (slate) — draft a refund larger than the remaining captured amount.
- `denied` (red) — see the stale-page trick below.
- `unknown` (blue) — NOT reachable as an operation banner: processor uncertainty is produced by the
  outbox worker under the system principal, so `unknown` only ever appears as a record **state** badge
  (with `unknownSince` set). Report it as unreachable rather than as a rendering failure.

### Producing a real `denied` banner without devtools/curl
Ineligible actions are correctly hidden or disabled, so the honest way to hit the server's denial path
is a stale tab: open the record in tab 1 while acting as a principal who *may* act (e.g. Omar with
`reconcile` enabled, or Omar with Approve on a pending request), switch the principal to someone
ineligible in tab 2, then submit the still-rendered form in tab 1. Expect a red **Denied** badge, the
hint "You do not hold the authority for this action.", an unchanged record, and an `auth_denied` row in
History and `/audit`. Note Chrome may restore the old "Acting as" `<select>` value on the stale tab —
trust the disabled-button tooltips / server render, not the select, to tell who is acting.

## Historical UI gaps (fixed in 87e694e — re-check if they regress)
- Approval denials used to redirect with `?decision=denied` and render **no banner**; they now map onto
  the shared statuses. If a denial returns silently, that regression is back.
- The "Awaiting approval" Approve/Reject buttons used to render enabled for everyone who could read the
  record. Now `detailView.pendingApprovals[].decidable` gates them, and ineligible principals see the
  request still listed with "you cannot decide this: <reason>" (separation of duties for the requester,
  "approval requires one of: finance_manager" for others).

## KYC review queue (`/r/kyc-cases`)
Seeded case ids are **fixed**, not cuids: `kyc-1` KYC-4001 (consumer, risk 22, identity doc, claimed by
Nadia), `kyc-2` KYC-4002 (consumer, risk 81 = high risk), `kyc-3` KYC-4003 (consumer, **no identity
doc**, a `reject` already parked awaiting compliance), `kyc-4` KYC-5001 (bu-smb).
- PII masking: ssn `••••6789`, dob year only, address `21••••OR`. Verify absence of raw values in the
  **page HTML**, not just the pixels (grep the saved DOM/HTML for the seeded raw ssn/address).
- Reveal is per-field via a `?reveal=<field>` link; it renders an amber "revealed · audited" badge and
  writes a `read` / `kyc_case:reveal_pii` audit event naming the field. Other fields stay masked.
- Auditors (Ava) have `kyc_case:read` but are denied reveal by an explicit `auditor_never_reveals_pii`
  rule: no reveal links render, and a hand-edited `?reveal=ssn` URL still returns masked data.
- Decision controls live in the app's own "Decide this case" panel (declared as `panelActions`), so the
  generated "Actions" card shows only claim/release. A case must be claimed before deciding.
- Guards worth exercising (each returns a slate **Invalid** banner, not a silent no-op): reason shorter
  than 10 chars, and approving a case with no identity document ("approving would be unevidenced").
- Approvals: `reject` always needs a compliance_officer; `approve` needs one at riskScore ≥ 70. The
  requester can never approve their own request. `compliance_officer` has `kyc_case:approve` but **not**
  `kyc_case:decide`, so Omar can only act through the "Awaiting approval" card — his panel buttons are
  correctly disabled. On approval the case applies **the requester's** reason, not the approver's note.
- Holder exclusivity: a claimed case can only be decided by its assignee. To test, claim as Nadia then
  act as Omar (global read, so he can read the case with PII masked). Any decide action returns a
  slate **Invalid** banner `the case is claimed by usr-nadia; only they can decide it` — `invalid`
  (domain), deliberately not `denied` (authority). `release` behaves the same way. `claim` is refused
  differently: it is state-based, so the generated button renders *disabled* with the title
  `only available while new or info_requested`.
- Fixed in `d1941e7`: `Transition.availableWhen({record, principal}) => string | null` (advisory, guard
  still enforces) is evaluated by `availableActions()` **after** the permission and state checks, so a
  non-holder now sees the panel decide buttons *and* `release` disabled with the hover title
  `the case is claimed by usr-nadia; only they can decide it`. Verify with a hover screenshot (the
  reason is a native `title=` tooltip — hover ~2s and nudge the mouse for it to appear).
  Consequence of that ordering: on an unassigned case (`new`/`info_requested`) the *state* reason wins
  (`only available while in_review or escalated`), so `notHeldBy`'s
  `claim the case before deciding it` string is unreachable through the UI — the buttons are still
  disabled, just with the state wording. Don't report that as a regression.
- Note: `invalid` guard refusals are intentionally not audited (nothing was written), so don't expect
  rows in `/audit` for them. Nadia (kyc_analyst) lacks `audit_event:read`, so `/audit` is denied for her —
  check audit attribution as Ava or Omar.

## Feature flags (`/r/flag-configs`)
- One seeded flag, `checkout_v2`, with a config per environment (development / staging / production).
- Scope dimension is `environment` (not business unit). Principals: `usr-sam` (engineer,
  development+staging), `usr-omar` (release_manager, all envs), `sys-flag-publisher` (system
  principal that lands publish outcomes), `usr-ava` (auditor, global read).
- Config ids are cuids, so never guess a URL: open the list and copy the id from the row's `Open` link.
  For the cross-scope denial test, copy the production id while acting as Omar, then switch to Sam and
  paste it — expect "Access denied … outside your environment scope (production)" plus an `auth_denied`
  row in `/audit`.
- Update happens through the `RolloutPanel` form (`enabled`, `rollout %`, hidden `expectedVersion`);
  `rollback` is a generated action button. `publish succeeded` / `publish failed` buttons are always
  disabled for humans (`no role held by X grants flag_config:publish`) — publication only happens via
  **Run effect worker** at the bottom of the detail page, which is also what makes the badge move from
  `vN saved, vM live` (amber) to `vN live`.
- While `state = publishing` the panel's Save button is disabled with
  `only available while live or publish_failed`. Run the effect worker before trying the next change.
- Guard messages to expect (all render as slate **Invalid**, never red Denied):
  ramp down → `a rollout only ramps up: 80% -> 50% is a rollback, which needs the rollback action`;
  unticking Enabled → `turning a flag off is a rollback, not a config change`;
  stale form → `this change was written against version N; the flag is now at version M...`.
  Reach the stale case with the browser Back button (the hidden `expectedVersion` goes stale) — no
  devtools needed.
- Publish failure is scripted: a rollout of exactly **66%** makes the fake service reject the publish →
  `state publish_failed`, `publishError = flag service rejected the config`, badge stays amber. Useful,
  but it also means 66% can never be used as an ordinary ramp value.
- Production ramps **above 25%** park as amber `Awaiting approval · policy: production_rollout` and
  require a *different* release manager; the requester sees the card with
  `you cannot decide this: you requested this change; a different person must approve it` and no
  buttons. Rollback needs no approval at all. With one release manager seeded, such a ramp stays
  pending forever; the seed instead leaves a completed sub-threshold production ramp by Omar.
- Known gaps seen in testing (might still be open): `invalid` guard refusals write no audit row, and a
  red **Denied** operation banner is not reachable in this app because scope failures short-circuit at
  read time into the Access denied page.

## Devin Secrets Needed
None — `.env` in the repo (or `.env.example`) supplies the local Postgres URL and a dev session secret.
