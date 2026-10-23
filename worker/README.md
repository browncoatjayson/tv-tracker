# TV Tracker push Worker

A tiny Cloudflare Worker that delivers the "airing soon" notifications **even when
the app is closed**. The PWA uploads its push subscription and the fire times of
its upcoming notifications; a cron (every 5 min) sends a push when one is due.
The push carries no payload — the service worker reads the notification text from
a small local store the app keeps in sync — so no message encryption is involved.

```
app (browser) ──POST /register {subscription, fireAts}──▶ Worker ──▶ KV
Worker cron (*/5) ──Web Push "wake"──▶ FCM/APNs ──▶ service worker ──▶ notification
```

## One-time setup

You need a (free) Cloudflare account and [`wrangler`](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
(`npm i -g wrangler`, then `wrangler login`).

### 1. Generate VAPID keys (once)

```bash
npx web-push generate-vapid-keys
```

Keep both values. The **public** key is used in two places (Worker var + the app);
the **private** key is a Worker secret only.

### 2. Create the KV namespace and fill in `wrangler.toml`

```bash
cd worker
wrangler kv namespace create SUBS
```

Paste the returned `id` into `wrangler.toml` (`[[kv_namespaces]] id = "…"`), and set:

- `VAPID_PUBLIC` = your VAPID **public** key
- `VAPID_SUBJECT` = `mailto:you@example.com`
- `ALLOWED_ORIGINS` = your app origin + localhost (comma-separated), e.g.
  `https://browncoatjayson.github.io,http://localhost:5173`

### 3. Add the private key as a secret and deploy

```bash
wrangler secret put VAPID_PRIVATE   # paste the VAPID private key
wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g. `https://tvtracker-push.<you>.workers.dev`.

### 4. Point the app at the Worker

Set these (both public) for the web build — locally in `.env`, and in the repo as
Actions secrets `VITE_VAPID_PUBLIC` / `VITE_PUSH_API` (already referenced by
`deploy.yml`):

```
VITE_VAPID_PUBLIC=<the SAME VAPID public key>
VITE_PUSH_API=https://tvtracker-push.<you>.workers.dev
```

Rebuild/redeploy the app. In **Settings → Airing-soon notifications**, enable
them, then tap **Send test** to confirm a notification arrives.

## Notes

- Cron granularity is 5 minutes, so a notification can land up to ~5 min early;
  the 15-minute lead absorbs that.
- Dead subscriptions (HTTP 404/410) are pruned automatically.
- Costs: comfortably within Cloudflare's free tier for personal use.
- Endpoints: `POST /register`, `POST /unregister`, `POST /test` (all JSON, body
  `{ id, ... }`). `id` is a hash of the push endpoint, computed by the app.
