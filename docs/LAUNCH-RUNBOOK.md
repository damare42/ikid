# Launch runbook

Ordered steps to get the website live and the repo presentable. Everything
here runs on **your** Mac — no tokens are ever pasted into a chat.

## Status

| Step | State |
| --- | --- |
| 0. Verify locally | ✅ 207 tests, both typechecks, client build, lint — all clean |
| 1. Merge `redesign` → `main` | ✅ merged as `00dd874` and pushed |
| 2. Enable GitHub Pages | ✅ **live at https://damare42.github.io/ikid/** (verified: page, `robots.txt`, non-HTML assets all serving) |
| 3. Fill in the repo's About box | ✅ description, website (via the Pages checkbox), 14 topics; Releases panel hidden |
| 4. Security settings | ⬜ **next** — and there's more here than expected, see below |
| 5. Announce | ⬜ your call, whenever |

**The red ✗ on the merge commit is stale, not a real failure.** Deploy site #1
ran on `00dd874` before Pages was switched on and failed in 8s; run #2, started
manually, succeeded in 23s and is what's live. Every other check on that commit
is green — CodeQL, audit, and tests on macOS, Ubuntu and Windows. The ✗ clears
itself on the next push that touches `site/**`.

Other verified facts:

| | |
| --- | --- |
| Repo | `damare42/ikid` — public |
| Releases | none published — the site says so plainly rather than linking to an empty page |
| Data leaked to git | none — only `database/.gitkeep` and `uploads/.gitkeep` were ever committed |

---

## 0. Before you merge — verify locally (10 min) ✅ done

```bash
cd ~/Projects/Menged
git checkout redesign
npm ci
npm test --workspace server     # expect: 207 passing
npm run build                   # typecheck + build both packages
npm run lint
```

Then open the site as a file and click through it:

```bash
open site/index.html
```

Check: it renders with no network access (turn Wi-Fi off — it should look
identical, because the page fetches nothing), the three mockups look right in
both light and dark mode, and every link goes where you expect.

Finally, the real smoke test — `docs/RELEASE-CHECKLIST.md` §"Manual smoke".
Import a statement, sign out (you should land on the welcome page), sign back
in, and export your data as JSON from Settings.

## 1. Land `redesign` on `main` ✅ done

22 commits is a lot to review in one PR, but the history is clean and
each commit stands alone, so a **merge commit** keeps that story intact:

```bash
git checkout main
git pull
git merge --no-ff redesign -m "Merge redesign: new design system, retirement planner, debt payoff, JSON export, marketing site"
git push origin main
```

If you'd rather have it reviewable on GitHub, open a PR from `redesign` into
`main` instead and merge it there — same result, and you get the CI run
attached. Don't squash: the individual commit messages explain several
non-obvious decisions (the dedupe-hash change, the scrypt upgrade, the
name-not-id export format) and squashing throws that away.

## 2. Turn on GitHub Pages ✅ done — https://damare42.github.io/ikid/

Repo → **Settings → Pages** → Source: **GitHub Actions**.

That's all — `.github/workflows/pages.yml` is already committed and triggers on
any push to `main` that touches `site/**`. The merge in step 1 does exactly
that, so the first deploy should start on its own. Watch it in the **Actions**
tab.

Live at **https://damare42.github.io/ikid/** within a couple of minutes.

Then check the two things that only work once it's live:

- `https://damare42.github.io/ikid/og.png` loads (the social preview)
- Paste the site URL into Slack or iMessage — you should see the preview card,
  not a bare link

## 3. Fill in the repo's front door ✅ done

A stranger landing on the repo currently reads **"No description, website, or
topics provided."** Topics matter most: they're how people *find* a repo, and
without them the project is invisible to GitHub search. This is the
highest-leverage five minutes on the list.

**One command** (needs `brew install gh && gh auth login`):

```bash
./scripts/set-repo-metadata.sh
```

It sets the description, points the website at the now-live Pages URL, and
applies 14 topics — the category (`personal-finance`, `budgeting`,
`expense-tracker`), the differentiator (`local-first`, `offline-first`,
`privacy`, `self-hosted`), and the stack (`sqlite`, `typescript`, `react`,
`nodejs`). Re-running is safe: it clears topics you've dropped rather than
piling new ones on top.

**Or by hand** — repo home → ⚙️ next to **About**:

- **Description**: `Local-first personal finance. Import bank statements, categorise, budget, and plan retirement — entirely on your own machine. No cloud, no bank logins, no telemetry.`
- **Website**: `https://damare42.github.io/ikid/`
- **Topics**: paste the list from the script

Either way, finish with the one thing `gh` can't do: **untick "Releases"** in
that same panel. An empty Releases section reads as a broken promise until you
actually publish one.

## 4. Security settings ← you are here

Observed state of https://github.com/damare42/ikid/security:

| | |
| --- | --- |
| Security policy | ✅ enabled (`SECURITY.md`) |
| Secret scanning alerts | ✅ enabled |
| Code scanning (CodeQL) | ✅ enabled — **253 open alerts** |
| Dependabot **alerts** | ❌ **disabled** |
| Private vulnerability reporting | ❌ **disabled** |
| Open PRs | 10 (Dependabot *version* updates) — **all 10 assessed, see below** |

Two of these are one click each, and both matter more than they look:

- **Enable Dependabot alerts.** This is the odd one. `.github/dependabot.yml`
  is already opening version-bump PRs — that's the 10 in the Pull requests tab
  — but the half that tells you *"this dependency has a known CVE"* is switched
  off. You're getting the noise without the signal. Enabling it also lets
  Dependabot prioritise security fixes over routine bumps.
- **Enable private vulnerability reporting.** Without it, someone who finds a
  real flaw in a *personal finance app* has nowhere to tell you except a public
  issue — which discloses it to everyone at the same moment it reaches you.

Then, less urgent but worth doing:

- **Branch protection on `main`** — require a PR and require the `test` and
  `audit` checks. Deliberately *not* `Deploy site`: it only runs on `site/**`
  changes, so requiring it would block every code-only PR forever.
- ~~Triage the 253 code-scanning alerts.~~ **Done — and the number was mostly
  our own configuration's fault.** Two causes, both fixed in
  `.github/codeql/codeql-config.yml`:
  - the scan included `design/`, which is standalone design-tool scaffolding
    that nothing imports. `design/support.js` alone is 1,911 lines whose header
    says *"GENERATED … do not edit"*, and transpiled bundles trip a lot of
    queries for no useful reason;
  - it ran the `security-and-quality` suite, whose quality half is a style
    linter that overlaps with the ESLint + TS-strict run this repo already does
    on every commit.

  It now runs `security-extended` — a **superset** of the default *security*
  queries — over app code only. Security coverage went up; what was dropped is
  style commentary another tool already covers. Expect a much smaller number on
  the next scan; whatever survives is worth reading individually.

  **Result, read from the actual alert list: 253 → 81 open, 174 auto-closed.**
  Of the 81 that remained, all but 12 were in `.github/skills` — 44,168 lines
  of vendored developer tooling, now also excluded. Everything genuinely in
  app code has been dealt with:

  | Finding | Count | Outcome |
  | --- | --- | --- |
  | Missing rate limiting | 11 | **Fixed** — `server/src/lib/rateLimit.ts`, verified live (30 × 200 then 429 with `Retry-After: 300`) |
  | Externally-controlled format string (`lib/logger.ts`) | 1 | **Fixed** — logging is now a single argument, so `%s` in a message can't swallow the metadata |
  | SQL injection | 0 | No `$queryRaw` anywhere; everything goes through Prisma's typed API |
  | XSS sinks | 0 | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` |
  | Command injection | 0 | No `child_process` in the server |

  Two further defects turned up in the manual pass and are fixed — see the
  commit for `server/src/lib/prisma.ts`.

The rest of `docs/REPO-SECURITY.md` still applies — 2FA, recovery codes,
Actions permissions, signed commits.

### The 10 Dependabot PRs, actually tested

Each was applied to a scratch copy and put through the full suite, both
typechecks, the client build and `npm audit`. They are not equivalent.

**Already taken (verified, in this repo now).** `react-router-dom` 6 → **7.18.3**
plus the in-range updates `npm update` picks up (papaparse 5.7.0, eslint 9.39.5,
prettier 3.9.6, tsx 4.23.12, autoprefixer 10.5.4, typescript-eslint 8.68.0).
React Router 7 needed **no code changes** — HashRouter, Routes, Route, NavLink,
useNavigate and useLocation are all unchanged — and it takes
`npm audit --omit=dev` from *2 moderate* to **0**. That advisory
(GHSA-337j-9hxr-rhxg) is an SSR-hydration bug and this app is a client-side
SPA, so it was never reachable here; it's fixed anyway because a standing
audit finding trains you to ignore audit findings. Note Dependabot's own PR
would **not** have fixed it: it proposed 6.30.6, which is still in the
affected range.

**Close these — the bots proposed them, but they're not merges:**

- **`@prisma/client` 5.22 → 7.9** is a migration, not an upgrade. Prisma 7
  removed `url` from the schema's `datasource` block (it now lives in
  `prisma.config.ts`) and dropped the `datasources` constructor option in
  favour of driver adapters. That constructor option is exactly how
  `lib/prisma.ts` builds a client per profile at runtime — it's the mechanism
  that keeps one person's data out of another's. Verified by running it: the
  CLI refuses the schema outright with P1012. Worth doing deliberately, with
  the per-profile isolation tests in front of you. Not from a bot PR.
- **`recharts` 2.15 → 3.10** produces **23 typecheck errors**, every one the
  same cause: v3 widened the `Tooltip` formatter's value to
  `ValueType | undefined`, so `formatter={(v: number) => …}` no longer fits.
  Mechanical, but it touches 9 page files, so it deserves its own commit.
  (The vite build passes regardless — vite doesn't typecheck — so *this would
  have looked fine locally and failed in CI*.)
- **`vitest` 2.1 → 4.1** — the suite passes on it, all 214. The blocker is
  npm: 10.9.8 crashes resolving vitest 4's peer set with
  `Cannot read properties of null (reading 'edgesOut')`, inside npm's own
  arborist. npm 11 installs it fine. So this one is gated on upgrading npm
  first, not on any code change.

**The five GitHub Actions bumps are fine to take**, but take the three Pages
ones *together* — `configure-pages` 5 → 6, `deploy-pages` 4 → 5,
`upload-pages-artifact` 3 → 5 — since they cooperate on one deploy, and watch
the run afterwards. `setup-node` 5 → 7 is CI-only; `action-gh-release` 2 → 3
only matters once you publish a release.

## 5. Only when you're ready for people to arrive

The site and repo can be live and quietly correct for as long as you like.
Announcing is a separate decision.

Before you post anywhere:

- [ ] `git ls-files database/ uploads/ | grep -v .gitkeep` prints nothing
      (verified clean today — re-check after the merge)
- [ ] Someone who isn't you follows the quick start on a clean machine and
      gets to a dashboard. This is the single most valuable test on the list;
      every project's install instructions work on the author's laptop.
- [x] `npm audit --omit=dev` is clean — it wasn't (2 moderate, via
      react-router-dom); fixed by taking React Router 7. Re-check after any
      dependency change
- [ ] Decide what you want back. "Try it and tell me what broke" gets more
      useful replies than "check out my app".

Places that fit this project: r/selfhosted, r/personalfinance (read the rules
first — self-promotion rules are strict), Hacker News *Show HN*, lobste.rs.
Expect the first questions to be "why not Actual Budget / Firefly III?" and
"how do I get my data out?" — the answer to the second is now
`docs/EXPORT-FORMAT.md`, which is worth linking pre-emptively.

## Known gaps at launch, stated plainly

These are honest limitations, already reflected on the site rather than hidden:

- **No published installers.** Unsigned builds are worse than no builds, so the
  site leads with clone/Docker. Signing (Apple Developer ID, ~$99/yr; Windows
  code-signing cert) is the unlock.
- **No screenshots.** The site uses hand-drawn CSS illustrations of the real
  screens. They're accurate but stylized. Real screenshots would convert
  better — capture a few once you have a profile you're happy to show.
- **No demo.** Nobody can try it without installing it. A seeded demo profile
  behind a flag is the cheapest fix; see `docs/COMPETITIVE-NOTES.md` §1.
- **Not audited.** The security design is documented and its claims are tested,
  but no third party has reviewed it. The site says so.
