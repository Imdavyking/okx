# AgentTrust

A reliability/reputation oracle for AI agents on OKX.AI. Monitors other ASPs
and exposes three tools so calling agents can check reliability before
hiring a service.

## Endpoints (free A2MCP — no x402 required)

- `GET /check_reliability?asp_id=xxx` — uptime, latency, error rate, schema
  drift, open incidents, composite 0-100 score for one ASP
- `GET /compare_asps?category=finance` — ranked list of ASPs in a category
- `POST /report_incident` — `{ asp_id, description, evidence_url }`
- `POST /register_asp` — self-serve registration, see below
- `GET /asps` — list everything currently tracked
- `GET /health` — used by OKX.AI (and by AgentTrust's own self-check)

## Self-serve registration

Any ASP can add itself to be monitored without editing code:

```bash
curl -X POST https://your-agenttrust-url.com/register_asp \
  -H "Content-Type: application/json" \
  -d '{
    "id": "riskgate",
    "name": "RiskGate Token Risk Report",
    "category": "finance",
    "endpoint_url": "https://riskgate.example.com/health",
    "method": "GET"
  }'
```

Fields: `id` (lowercase, letters/numbers/hyphens/underscores, 2-64 chars),
`name`, `category` (`finance` | `software` | `lifestyle` | `art`),
`endpoint_url` (must be public HTTPS — no localhost/private IPs), and
optionally `method` (`GET`/`POST`, defaults to `GET`) and `test_payload`
(JSON string, for POST endpoints).

On registration, AgentTrust makes one live test call to `endpoint_url` to
confirm it's actually reachable before accepting it — this stops obviously
broken URLs and typos from polluting the monitored list. It does **not**
validate the response shape or content, only that something answered.
Duplicate `id`s are rejected with a 409 rather than silently overwritten.

Newly registered ASPs appear with `sample_size_7d: 0` and a `null`
`composite_score` on `check_reliability` until the next poll cycle runs.

## Local setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate     # creates dev.db and applies the schema
npm run seed               # populates the initial ASP list
npm start                  # runs server + poller on the schedule
```

## Adding ASPs to monitor

Edit `prisma/seed.js` and add entries to the `ASPS` array, then re-run
`npm run seed`. Each entry needs: `id`, `name`, `category`
(`finance` | `software` | `lifestyle` | `art`), `endpointUrl`, and `method`
(`GET` or `POST`). Point `endpointUrl` at a cheap, ideally free/read-only
route on the target ASP — don't hammer a paid endpoint with monitoring
traffic.

## Deploying (Railway example)

1. Push this folder to a GitHub repo.
2. Create a new Railway project from that repo.
3. Set the `DATABASE_URL` env var. For a quick launch, SQLite on a
   persistent volume is fine (`file:./prod.db`); for anything longer-lived,
   swap the Prisma datasource provider to `postgresql` and use Railway's
   managed Postgres instead — SQLite doesn't survive container redeploys
   without a mounted volume.
4. Railway will run `npm install` automatically. Add a build step (or
   Railway "Deploy" command) that runs `npx prisma generate && npx prisma
migrate deploy` before `npm start`.
5. Once deployed, note the public HTTPS URL — that's what you register as
   your A2MCP endpoint on OKX.AI.

## Notes / honest limitations (MVP scope)

- Schema-drift detection currently always returns `true` (match) — it's
  wired up to compare against a stored baseline, but the baseline snapshot
  itself isn't persisted yet. To make this real, add a `responseKeys`
  column to `Ping` and store `Object.keys(response).sort().join(',')` on
  each successful ping, then compare against the most recent one.
- Composite score weights (0.5 uptime / 0.3 error-rate / 0.2 latency, minus
  5 pts per open incident) are a reasonable starting formula — tune freely.
- No auth on `/report_incident` or `/register_asp` yet — anyone can file an
  incident against any ASP, and anyone can register a new one. Fine for a
  hackathon demo; before production you'd want to require some form of
  signed/identified caller (e.g. tie registration to the OKX Agentic Wallet
  identity that owns the ASP) so incidents and registrations can't be spoofed
  or spammed.
