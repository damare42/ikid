# Phase 1 — put ikid online (self-host beta)

Goal: use ikid from anywhere, over HTTPS, sign-in required, invite-only, with
backups — and **zero compromises to the principles**. Your data stays on *your*
server; no third parties. This is the fast, safe first step from
`docs/ONLINE-PLAN.md`.

You need: a domain name, and a small Linux server (any $5–10/mo VPS —
DigitalOcean, Hetzner, Linode — or Fly.io). ~30 minutes.

---

## Option A — VPS + Docker + Caddy (recommended, full control)

### 1. Point your domain at the server
Create a DNS **A record** (and AAAA if you have IPv6) for e.g.
`money.example.com` → your server's IP. Wait for it to resolve.

### 2. Install Docker on the server
```bash
curl -fsSL https://get.docker.com | sh
```

### 3. Get the code onto the server
```bash
git clone https://github.com/damare42/ikid.git
cd ikid
```

### 4. Configure your domain
- Edit `deploy/Caddyfile` → replace `money.example.com` with your domain.
- Edit `deploy/docker-compose.prod.yml` → set `IKID_ORIGIN=https://<your-domain>`.

### 5. Launch
```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```
Caddy automatically obtains a Let's Encrypt certificate. Give it a minute, then
open **https://your-domain**.

### 6. Become the admin, then lock it down
- **Sign up** — the first account is automatically the admin.
- Go to the **🛡️ Admin** page → turn **Allow new sign-ups** OFF.
- Invite others by having them... actually, with sign-ups off you create their
  accounts: temporarily toggle sign-ups on, have them register, toggle off —
  or add per-user sign-up back in Phase 2. For a handful of trusted people the
  toggle-on/off dance is fine.

### 7. Turn on backups
```bash
# one-off test
BACKUP_DIR=/root/ikid-backups deploy/backup.sh

# daily at 02:30 via cron
crontab -e
# add:
30 2 * * *  cd /root/ikid && BACKUP_DIR=/root/ikid-backups RETAIN=30 deploy/backup.sh >> /var/log/ikid-backup.log 2>&1
```
Copy those archives somewhere off the box (they hold real financial data and
password hashes — keep them encrypted).

---

## Option B — Fly.io (managed, less server babysitting)

1. Install flyctl and `fly launch` from the repo (it detects the Dockerfile).
2. Set secrets/env:
   ```bash
   fly secrets set IKID_REQUIRE_AUTH=1 IKID_SECURE_COOKIES=1 IKID_TRUST_PROXY=1 IKID_ORIGIN=https://<your-app>.fly.dev
   ```
3. Add a **persistent volume** mounted at `/app/database` (Fly volumes) — this
   is where all data lives; without it, deploys wipe everything.
4. `fly deploy`, open the URL, sign up, turn off sign-ups.
5. Back up with `fly ssh console` + the same `tar` approach, or volume
   snapshots.

Fly gives you HTTPS automatically, so you can skip Caddy.

---

## What makes this "principled" already

- **Self-hosted:** the app runs on your server; data never touches a third
  party. Same architecture as the local app.
- **Auth required:** `IKID_REQUIRE_AUTH=1` means no one reaches data without an
  account. `IKID_SECURE_COOKIES=1` keeps session cookies HTTPS-only.
- **Isolated:** every account is a separate database; one user can't see
  another's data.
- **No telemetry leaves the box:** usage analytics are local, feature-only, and
  first-party.

## Verify it's healthy

```bash
curl -fsS https://<your-domain>/api/health      # {"ok":true,"app":"ikid"}
docker compose -f deploy/docker-compose.prod.yml logs -n 20 ikid
```
The server logs its data dir, profiles, and `Auth: required (accounts mode)` on
boot — a quick sanity check that it's using the right volume.

## Environment reference (Phase 1)

| Variable | Set to | Why |
|---|---|---|
| `IKID_REQUIRE_AUTH` | `1` | Force sign-in (never open mode on a network) |
| `IKID_SECURE_COOKIES` | `1` | Session cookie only over HTTPS |
| `IKID_TRUST_PROXY` | `1` | Trust Caddy/Fly `X-Forwarded-*` (cookies, client IP) |
| `IKID_ORIGIN` | `https://your-domain` | Restrict CORS to your site |
| `PORT` | `3001` (default) | App port behind the proxy |

## Limits of Phase 1 (what Phase 2 adds)

This is great for you plus a few invited people. Before opening to the public
you'll want email sign-up/verification, password reset, a privacy policy, and
self-serve data export/delete — that's Phase 2/3 in `docs/ONLINE-PLAN.md`.
