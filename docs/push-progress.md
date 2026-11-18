# Push integration progress

- Frontend production: dpl_HCACcXQYYqigAKQ3XeRTbaxyHj7u, k119.vercel.app.
- Administrator action column and driver picker verified visually on production.
- Supabase dispatch-push function deployed; push.sql applied successfully.
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_WORKER_SECRET stored only in Supabase function secrets. No secret values are in this repository.
- Browser polling notifications were removed. Permission alone no longer reports a successful push connection.
- Android device selected by user. Physical installation and receipt have not been tested.

## Pending

1. User action-time approval requested for replacing the Edge legacy JWT gateway check with the function's auth.getUser/profile validation and worker secret validation. Do not change this setting until answered.
2. After approval, connect a scheduled worker call (pg_cron/pg_net with the worker credential stored in Vault, never as a source-code literal). Use action=deliver. Keep gateway disabled only for this explicitly authenticated function.
3. Verify subscriber isolation, unauthorized requests, queue retries, then test actual Android push receipt while the app is closed.
4. Add platform-compatible PNG install icons and verify installation requirements on the physical Android browser.

Current push delivery is NOT fully operational. Function credentials are initialized, but worker scheduling and gateway switch remain pending. No successful physical push delivery has been claimed.
