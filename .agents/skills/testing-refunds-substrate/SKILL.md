---
name: testing-refunds-substrate
description: How to run and end-to-end test the internal-tools-platform substrate apps (refunds) locally in the browser — environment startup, principal switching, reaching each operation status, and known UI gaps.
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
There is no login. The header has an "Acting as" `<select>` + **Switch** button that sets a signed
cookie. A fresh browser profile shows "No principal selected" — pick someone first.
Seeded principals: Sofia Ramos (support_agent, bu-consumer), Dan Whitfield (support_agent, bu-smb),
Priya Nair (finance_manager, bu-consumer — the only eligible approver), Ava Chen (auditor, global read).
System principal `sys-refund-settler` performs outbox effects.

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
- Scope isolation: as Sofia, `/r/payments/pay-smb-1` renders an "Access denied" card; list headers show
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
is a stale tab: open the record in tab 1 while acting as a principal who *may* act (e.g. Priya with
`reconcile` enabled, or Priya with Approve on a pending request), switch the principal to someone
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

## Devin Secrets Needed
None — `.env` in the repo (or `.env.example`) supplies the local Postgres URL and a dev session secret.
