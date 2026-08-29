# Test plan — PR #14 WorkOS-style console shell

App: http://localhost:3000 (dev server running, Postgres up + seeded).
Principal switching: sidebar "Acting as" native select (submits on change) — `src/components/principal-switcher.tsx`.

## T1 — Shell correctness
1. Sidebar shows groups Feature flags / KYC / Refunds / Platform; click each Platform page.
   PASS: `/platform/roles`, `/platform/resource-types` (SVG diagram visible), `/platform/policies` all render content (not blank/error); active nav item is visually highlighted for the current route (`nav-link.tsx`).
2. Breadcrumbs in header for `/r/refunds` = "Overview / Refunds"; for a refund detail = "Overview / Refunds / <id>" with the id **verbatim** (truncated with … only if >18 chars) — copy the shown id vs the IdChip.
3. `/audit` shows a hash-chain badge "verified · N events".

## T2 — Authorization not weakened
4. As Sofia Ramos (support_agent, bu-consumer) open `/r/payments`: header badge "N of N visible" + "scoped to business_unit bu-consumer"; N equals rendered row count and `pay-smb-1` is absent.
5. Use the new search box: type `smb` on `/r/payments`. PASS: "Nothing matches “smb”." — no out-of-scope row appears.
6. Navigate directly to `/r/payments/pay-smb-1` as Sofia. PASS: shared **Access denied** panel with a reason naming the scope; no record fields rendered.
7. As Nadia Haddad (kyc_analyst) open `/r/refunds`. PASS: list-level Access denied panel (header still shows "Refunds"), zero rows.
8. Row `…` menu on a scoped list: opens, offers Open record / View audit log / Copy record ID only — no mutating item. Clicking "View audit log" lands on `?tab=audit` of that record.

## T3 — PII masking + audited reveal
9. As Nadia open `/r/kyc-cases/kyc-1`: ssn shows `••••6789`, address masked. Grep saved page HTML for raw ssn — PASS if raw value absent.
10. Click the `reveal` link on ssn. PASS: value un-masked + amber "revealed · audited" badge; other PII fields stay masked; Audit tab shows a `read` / `kyc_case:reveal_pii` event naming field ssn.
11. Switch to Ava Chen (auditor) on the same case. PASS: no reveal links; hand-edit URL `?reveal=ssn` → value still masked, no revealed badge.
12. Tab switching: from a revealed details URL click Approvals then Details. Record whether `reveal` persists (expected: dropped, values re-masked — acceptable/safe). FAIL only if reveal persists without a new audit event.

## T4 — Operation statuses on tabbed detail page
13. `ok`: as Sofia, `/r/payments/pay-consumer-1` → Request a refund, $5.00 → green "Applied" banner on refund detail.
14. `invalid`: draft refund above remaining captured amount → slate Invalid banner with guard message.
15. `pending`: submit a refund > $100.00 → amber "Awaiting approval" banner, record state stays `draft`.
16. `denied`: stale-tab trick (render approve/decide form as an eligible principal, switch principal in another tab, submit) → red Denied banner "You do not hold the authority for this action.", record unchanged, `auth_denied` row in Audit tab.
17. `unknown`: reach state via $40.13 refund + Run effect worker → blue `unknown` state badge (banner form documented as unreachable by skill; not a failure).

## T5 — Approvals tab + separation of duties
18. On the pending refund from step 15, Approvals tab count badge = 1; as requester (Sofia) the row shows "you cannot decide this: …" and **no** Approve/Reject buttons.
19. Switch to Priya Nair (finance_manager) → Approve button present; click Approve → ok banner, state advances, approvals count returns to 0, Audit tab has a `decision` event by usr-priya.

## T6 — Feature flag production change requires release_manager
20. As Renee (release_manager) copy a production config id from `/r/flag-configs`; switch to Sam (engineer, dev+staging) and open that id. PASS: Access denied naming environment scope production; `auth_denied` row in `/audit`.
21. As Renee ramp production above 25% (e.g. 40%) → amber pending "policy: production_rollout" with "a different person must approve"; switch to Mira (release_manager) → Approve available and applies.

Evidence: screenshot each PASS/FAIL assertion; annotate recording per test.
