# Push integration progress — 2026-11-19

- Frontend production: dpl_BXw7PbgSaSrKXBhYn3UsfVdkPtpC (READY), k119.vercel.app; index-CSx_iky7.js verified live.
- Administrator action column and driver picker verified visually on production.
- Supabase dispatch-push function deployed; push.sql applied successfully.
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_WORKER_SECRET stored only in Supabase function secrets. No secret values are in this repository.
- Browser polling notifications were removed. Permission alone no longer reports a successful push connection.
- Android device selected by user. Physical installation and receipt have not been tested.

## Applied and verified

1. User explicitly approved legacy JWT gateway replacement. Applied OFF for dispatch-push only; config.toml preserves it.
2. push-worker.sql applied. Dedicated credential generated inside Vault, never displayed or copied into source. Service-role-only verify_dispatch_worker checks it. Previously initialized PUSH_WORKER_SECRET environment variable is now unused; VAPID keys unchanged.
3. Cron ems-dispatch-push invokes the function every minute. Observed HTTP 200 {"sent":0}; earlier 401 happened before updated server code was deployed.
4. Worker uses 2-minute queue leases, batches of 5, a 45-second processing budget and per-device delivery tracking. Cancelled/stale/inactive assignments retire; failures retry. A crash after provider acceptance but before persistence can still repeat delivery; the notification tag replaces the same booking's notification.
5. Missing bearer, malformed bearer and invalid 64-character worker secret all returned HTTP 401. Six DB privilege checks passed: anonymous worker denial, authenticated claim/invoke denial, subscription read denial, queue write denial and invalid secret rejection.
6. Authorized fake booking tested inside a rolled-back transaction: confirmed transition queued notification, first claim succeeded, second claim returned zero. No permanent booking changes or fake notification sent.
7. Manifest, PNG icons (192/512), service worker and notification-to-My-Trips navigation deployed. Public assets return HTTP 200. TypeScript/Vite build passed; lint has one pre-existing App.tsx:374 set-state-in-effect warning.

## Remaining physical device verification

Galaxy Chrome: k119.vercel.app → log in as jleejin@naver.com → My Trips → install → open installed app → connect dispatch notifications → allow. The user must grant the handset permission.

Then inspect subscription row count without displaying endpoints/keys. Use an authorized dispatch to confirm notification receipt while the app is closed and correct tap navigation. Actual Android delivery is NOT yet verified; no successful physical push receipt has been claimed.

Non-secret diagnostics: cron.job/job_run_details for ems-dispatch-push, net._http_response status/content, dispatch_push_queue counts. Never print request headers or decrypted Vault values. Original tables/data/RLS policies remain unchanged.
