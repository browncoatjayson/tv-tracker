# tvtracker-stats worker

Anonymous usage counter for TV Tracker. The app is a backend-less PWA, so there's
no server that can tell you how many people use it (and Google's OAuth metrics
only count Drive sign-ins, unreliably). This worker fills that gap **without
collecting any personal data**.

## What it stores

The app generates a random **install id** (a UUID) once per device, keeps it in
`localStorage`, and POSTs it here at most **once per day**. No email, account, or
IP is stored — only the opaque id. It's recorded in KV two ways:

| Key | Value | Meaning |
|---|---|---|
| `install:<iid>` | first-seen day | lifetime **unique installs** (no TTL) |
| `active:<day>:<iid>` | `1` | **daily-active** installs (~100-day TTL) |

That's enough to count total installs and daily-active users. Nothing identifies
a person; the id resets if the user clears site data.

## Setup

```bash
cd worker-stats

# 1. Create the KV namespace and paste the printed id into wrangler.toml
wrangler kv namespace create STATS

# 2. Set the admin key that guards GET /stats (pick a long random string)
wrangler secret put STATS_ADMIN_KEY

# 3. Deploy
wrangler deploy
```

Then point the app at it: set the repo secret **`VITE_STATS_API`** (and your local
`.env`) to the deployed worker URL, e.g. `https://tvtracker-stats.<subdomain>.workers.dev`.
Leave it unset to disable the ping entirely (e.g. local dev).

## Reading the numbers

```bash
curl "https://tvtracker-stats.<subdomain>.workers.dev/stats?key=YOUR_ADMIN_KEY"
```

Returns:

```json
{
  "totalInstalls": 42,
  "days": [
    { "date": "2026-11-09", "active": 7 },
    { "date": "2026-11-08", "active": 9 }
  ]
}
```

`totalInstalls` is lifetime unique devices; `days` is the last 30 days of
daily-active counts (most recent first). Counts are approximate at the edges
(KV is eventually consistent), which is fine for usage trends.

## Notes / limits

- **KV free tier**: 100k reads/day, 1k writes/day. The once-per-day, deduped ping
  means ~1 write per active device per day, so you'd need ~1,000 daily-active
  devices before the write quota bites — far beyond current scale.
- **Privacy**: because this introduces (anonymous) telemetry, mention it in
  `public/privacy.html` before shipping.
- The `/stats` endpoint lists KV keys to count them; at very large scale you'd
  switch to maintained counters, but list-counting is fine for this app.
