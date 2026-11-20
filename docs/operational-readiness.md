# Operational readiness work

## Agreed business rule

2026-11-19 user approved: hospital staff can edit/cancel before dispatch. After dispatch, request changes for administrator approval. Hospital cannot directly alter in-progress/completed trips.

## Stage 1

- Existing trip_type, waiting_required, waiting_minutes now queried for reservation lists, pagination, driver trips and hospital exports.
- Reservation detail and driver cards show trip type and waiting information; XLSX adds a transport information column. Unknown legacy values explicitly display as unconfirmed.
- Reservation rows refresh every 30 seconds while visible, and when the page resumes or network reconnects. Forms and active dispatch controls remain mounted. Dashboard aggregate counts are not part of this new background refresh.
- TypeScript/Vite build passed; existing lint warning remains. Live browser verification and cross-account refresh verification still required.

## Remaining, in order

2026-11-20 release: user approved production DB access addition. Applied reservation-changes.sql successfully; rollback assertions passed before and after change-push.sql. Deployed dispatch-push worker through dashboard and applied queue event metadata/trigger. Deployed frontend dpl_64zj3669GzqjERLYYZes8quH1q42 READY with k119.vercel.app alias. Admin production reservation detail renders without history-query errors. Existing fake reservation was already cancelled when inspected today; test transaction restored that state. No persistent test bookings added. Pending: browser submission/review with active reservation and physical receipt of change/cancellation push; SQL tests alone do not verify these. Earlier draft notes below describe preparation, superseded by this release entry.

Stage 2 prepared (not deployed): reservation-changes.sql adds a scoped history table and explicit authorization RPCs; ReservationChanges.tsx adds edit/cancel and admin review. Browser security policy requires action-time confirmation for the new hospital mutation access; requested from user. Build passed. Still must apply migration, run isolation/concurrency checks, handle post-dispatch change notifications, and verify the UI before release. Pending draft is not production-ready.

Stage 2 follow-up: null hospital authorization now fails closed; proposals are validated before pending requests are stored. Added rollback SQL assertions for direct editing, stale versions, unassigned/other hospital and inactive callers, post-dispatch approval and duplicate approval. These SQL assertions have NOT been executed against the database. Build and lint passed (existing effect warning and bundle size warning remain). change-push.sql and the worker draft now distinguish dispatch/change/cancellation, retaining the former driver for a cancellation notice; not deployed or delivery-tested. Release order: worker compatible with absent event_kind, queue metadata/trigger, reservation change migration, rollback verification, frontend, browser/physical-device verification. No production mutation performed in this follow-up.

1. Validate live stage 1 and extend refreshing to dashboard counters/new reservation notice.
2. Inspect live schema/RLS; implement agreed edit/cancel/change-request workflow with atomic status checks and original data preservation. No unauthorized changes to existing policies.
3. Improve signup hospital identification and approval verification; account deactivation management.
4. Separate completed 9090 transfers from external/cancelled/pending bookings for settlement; decide monthly reporting rules with user if ambiguous.
5. Server-side weekly XLSX archive, rather than claiming manual downloads are automatic archival.
6. Delivery acknowledgement/failure visibility, expired subscriptions and long offline receipt handling.
7. Reservation idempotency and two-hospital access isolation tests. Check backup/restore readiness before broad release.

Broad release is not approved by this checklist. Prior tests verified driver/admin dispatch flow and physical notification receipt; they do not prove all operational failure cases.
