# Operational readiness work

## Agreed business rule

2026-11-19 user approved: hospital staff can edit/cancel before dispatch. After dispatch, request changes for administrator approval. Hospital cannot directly alter in-progress/completed trips.

## Stage 1

- Existing trip_type, waiting_required, waiting_minutes now queried for reservation lists, pagination, driver trips and hospital exports.
- Reservation detail and driver cards show trip type and waiting information; XLSX adds a transport information column. Unknown legacy values explicitly display as unconfirmed.
- Reservation rows refresh every 30 seconds while visible, and when the page resumes or network reconnects. Forms and active dispatch controls remain mounted. Dashboard aggregate counts are not part of this new background refresh.
- TypeScript/Vite build passed; existing lint warning remains. Live browser verification and cross-account refresh verification still required.

## Remaining, in order

1. Validate live stage 1 and extend refreshing to dashboard counters/new reservation notice.
2. Inspect live schema/RLS; implement agreed edit/cancel/change-request workflow with atomic status checks and original data preservation. No unauthorized changes to existing policies.
3. Improve signup hospital identification and approval verification; account deactivation management.
4. Separate completed 9090 transfers from external/cancelled/pending bookings for settlement; decide monthly reporting rules with user if ambiguous.
5. Server-side weekly XLSX archive, rather than claiming manual downloads are automatic archival.
6. Delivery acknowledgement/failure visibility, expired subscriptions and long offline receipt handling.
7. Reservation idempotency and two-hospital access isolation tests. Check backup/restore readiness before broad release.

Broad release is not approved by this checklist. Prior tests verified driver/admin dispatch flow and physical notification receipt; they do not prove all operational failure cases.
