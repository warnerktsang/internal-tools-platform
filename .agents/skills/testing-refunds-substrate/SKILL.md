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

## Known UI gaps to watch for (may be fixed later)
- Approval denials are enforced and audited server-side but may render **no banner**: `decideApproval`
  redirects with `?decision=denied&message=…` while the detail page only renders a banner for
  `decision === 'recorded'`. Check the History table for an `auth_denied` row to confirm the server did
  the right thing, and treat the missing banner as a UI bug.
- The "Awaiting approval" Approve/Reject buttons are rendered enabled to every principal who can read
  the record (including the requester and read-only auditors) because `detailView.pendingApprovals` is
  not eligibility-filtered. Regular action buttons ARE correctly disabled with a reason tooltip.

## Devin Secrets Needed
None — `.env` in the repo (or `.env.example`) supplies the local Postgres URL and a dev session secret.
