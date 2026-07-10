# Deploying ikid (self-hosted)

ikid stays true to local-first even when self-hosted: all data lives in one
Docker volume on *your* server, and the app makes zero calls to third parties.

## Quick start

```bash
docker compose up -d
# → http://<your-server>:3001
```

First visit: click **Sign up** and create your account. The Docker image runs
with `IKID_REQUIRE_AUTH=1`, so a networked instance always requires sign-in —
open (no-login) mode is disabled by design.

Each household member signs up once and gets a fully isolated database.

## With the local AI planner

```bash
docker compose --profile ai up -d
docker compose exec ollama ollama pull llama3.1   # one-time, ~4.7 GB
```

The Planner's badge flips to "Local AI" automatically. The model runs in the
Ollama container on your hardware — nothing leaves your network.

## HTTPS (strongly recommended off-localhost)

Sessions are HttpOnly cookies; over plain HTTP on a LAN they can be sniffed.
Put ikid behind any TLS reverse proxy and set `IKID_SECURE_COOKIES=1`.

Example with [Caddy](https://caddyserver.com) (automatic Let's Encrypt):

```
# Caddyfile
money.example.com {
    reverse_proxy ikid:3001
}
```

Then in docker-compose, uncomment `IKID_SECURE_COOKIES=1` on the ikid service
and add Caddy to the same compose network.

## Backups

Everything is in the `ikid-data` volume (one SQLite file per user, plus
credentials and sessions):

```bash
docker run --rm -v ikid-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/ikid-backup-$(date +%F).tar.gz -C /data .
```

ikid also snapshots every database into `backups/pre-<version>/` inside the
volume automatically before any version upgrade.

## Upgrading

```bash
git pull
docker compose build && docker compose up -d
```

The startup sequence migrates legacy data, backs up all databases (on version
change), applies the schema, and seeds defaults — no manual steps.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port inside the container |
| `IKID_REQUIRE_AUTH` | `1` (in Docker) | Force sign-in even before any password exists |
| `IKID_SECURE_COOKIES` | unset | Add `Secure` to session cookies (set with HTTPS) |
| `OLLAMA_URL` | `http://localhost:11434` | Where the Planner looks for Ollama |
| `OLLAMA_MODEL` | `llama3.1` | Preferred model name |

## Threat model, honestly

This setup protects against other people on your network using the app and
against credential theft over HTTPS. The SQLite files inside the volume are
**not encrypted at rest** — anyone with root on the host can read them. Use
full-disk encryption on the server for that layer.
