# Push integration progress — 2026-11-19

- Frontend production: dpl_BXw7PbgSaSrKXBhYn3UsfVdkPtpC (READY), k119.vercel.app; index-CSx_iky7.js verified live.
- Administrator action column and driver picker verified visually on production.
- Supabase dispatch-push function deployed; push.sql applied successfully.
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_WORKER_SECRET stored only in Supabase function secrets. No secret values are in this repository.
- Browser polling notifications were removed. Permission alone no longer reports a successful push connection.
- Android installation, subscription and physical notification receipt verified on 2026-11-19. User confirmed receipt: “왔다. 다음”.

## Applied and verified

1. User explicitly approved legacy JWT gateway replacement. Applied OFF for dispatch-push only; config.toml preserves it.
2. push-worker.sql applied. Dedicated credential generated inside Vault, never displayed or copied into source. Service-role-only verify_dispatch_worker checks it. Previously initialized PUSH_WORKER_SECRET environment variable is now unused; VAPID keys unchanged.
3. Cron ems-dispatch-push invokes the function every minute. Observed HTTP 200 {"sent":0}; earlier 401 happened before updated server code was deployed.
4. Worker uses 2-minute queue leases, batches of 5, a 45-second processing budget and per-device delivery tracking. Cancelled/stale/inactive assignments retire; failures retry. A crash after provider acceptance but before persistence can still repeat delivery; the notification tag replaces the same booking's notification.
5. Missing bearer, malformed bearer and invalid 64-character worker secret all returned HTTP 401. Six DB privilege checks passed: anonymous worker denial, authenticated claim/invoke denial, subscription read denial, queue write denial and invalid secret rejection.
6. Authorized fake booking tested inside a rolled-back transaction: confirmed transition queued notification, first claim succeeded, second claim returned zero. No permanent booking changes or fake notification sent.
7. Manifest, PNG icons (192/512), service worker and notification-to-My-Trips navigation deployed. Public assets return HTTP 200. TypeScript/Vite build passed; lint has one pre-existing App.tsx:374 set-state-in-effect warning.

## Physical device test — 2026-11-19

User installed the app and enabled site notifications. Server confirmed one subscription for the designated driver. The existing authorized fake booking was temporarily changed from requested to confirmed with the designated driver and 9090 vehicle. The queue trigger created the delivery job; invoke_dispatch_push submitted request 18. Observed sent_at populated and one delivered endpoint. User confirmed the notification arrived on their phone. Physical background/closed-app state was requested but not independently confirmed.

The fake booking was restored to requested with null driver/vehicle and approval metadata. No reservation was deleted. Notification delivery evidence remains in the queue. No patient information was included in the push payload.

User confirmed that tapping the notification opens My Trips: “내 운행 화면이 열림”. Notification receipt and tap navigation passed. The fake booking is no longer assigned, so an empty My Trips list is expected. A sustained closed-app receipt test remains unconfirmed.

## Normal administrator UI flow — 2026-11-19

- Reused the authorized fake booking, temporarily moved scheduled_at into the future; original created_at unchanged.
- Clicked 9090 dispatch, selected 심재용, confirmed dispatch. Status became confirmed and My Trips displayed the correct fake patient, route and notes.
- Scheduled worker automatically delivered to one device (sent_at populated, delivered_endpoints count 1), without manually invoking the worker.
- Clicked Start Trip in My Trips; status changed to in_progress. Clicked Complete; booking disappeared from active trips. DB and refreshed reservation list both showed completed.
- Found a stale parent reservation list after changing status in My Trips. Fixed by calling the shared reservation refresh callback after successful trip actions.
- Fix deployed as dpl_FLdK7SwQF9ErTLFWufRwJEtymSmm (READY), asset index-GfkNk2GG.js. Retested completion in My Trips and navigation back to Reservations: completed appeared without manually refreshing. Build passed; pre-existing lint warning remains.
- After interruption, read-only DB verification confirmed the final test restoration: requested, scheduled_at 2026-11-18 10:27:00+00, null driver/vehicle/approval metadata. No repeat dispatch test was needed.
- Restored requested status, original scheduled_at (2026-11-18 10:27:00+00), null vehicle/driver/approval metadata. Original created_at retained. No booking deleted. Completion screenshot: dispatch-completed.jpg (fake data only).
- This verifies the existing reservation's administrator/driver flow. A new hospital-account submission was not repeated during this test; its prior test is separate.

Non-secret diagnostics: cron.job/job_run_details for ems-dispatch-push, net._http_response status/content, dispatch_push_queue counts. Never print request headers or decrypted Vault values. Original tables/data/RLS policies remain unchanged.
