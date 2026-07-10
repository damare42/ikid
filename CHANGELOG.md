# Changelog

## 0.2.0 — self-hosting

- Docker support: multi-stage image with healthcheck, persistent `/app/database` volume, and `docker-compose.yml` with an optional Ollama service (`--profile ai`)
- `IKID_REQUIRE_AUTH=1` forces sign-in even before any password exists (default in the Docker image, so networked instances never run in open mode)
- `IKID_SECURE_COOKIES=1` adds the `Secure` flag to session cookies for HTTPS deployments
- Profile renaming with permanent per-profile account IDs that survive renames
- Deployment guide (`docs/DEPLOY.md`): HTTPS via reverse proxy, volume backups, upgrade flow

## 0.1.0 — first public release

- Statement import (CSV + PDF, any bank) with column auto-detection, duplicate hashing, and a review/correct step
- Auto-categorization with 190+ seeded rules, learning from every manual correction
- Dashboard (month / year-to-date) with click-through drill-downs on every chart
- Conscious Spending Plan breakdown (fixed / investments / savings / guilt-free)
- Budgets with end-of-month forecasts; goals with completion-date math and what-if previews
- Analytics: trends, category & merchant breakdowns, top-10 merchants per category, recurring payment detection, spending heatmap
- Planner: deterministic what-if engine (house, car, wedding, moving, career break, emergency fund) + optional local AI via Ollama; conversations can be saved
- Smart insights, CSV export, print-to-PDF reports
- Merchant normalization (auto-merge variants) and manual merging
- Profiles: fully isolated per-person SQLite databases
- Accounts: scrypt-hashed passwords, HttpOnly session cookies, login rate-limiting, per-request database isolation, public sign-up
- Public landing page; light/dark theme; 47 unit tests
