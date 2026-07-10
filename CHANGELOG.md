# Changelog

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
