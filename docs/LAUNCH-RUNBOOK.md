# Launch runbook

Ordered steps to get the website live and the repo presentable. Everything
here runs on **your** Mac — no tokens are ever pasted into a chat.

Start-of-run facts (verified against the live repo):

| | |
| --- | --- |
| Repo | `damare42/ikid` — **already public**, 0 stars, 14 commits on `main` |
| Branch state | `redesign` is **22 commits ahead** of `main` |
| `site/` on `main` | **no** — so Pages has never deployed |
| Releases | **none published** |
| Repo description / topics / website | **not set** |
| Data leaked to git | none — only `database/.gitkeep` and `uploads/.gitkeep` were ever committed |

---

## 0. Before you merge — verify locally (10 min)

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

## 1. Land `redesign` on `main`

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

## 2. Turn on GitHub Pages

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

## 3. Fill in the repo's front door

Repo home → the ⚙️ next to **About**:

- **Description**: `Local-first personal finance. Import bank statements, categorise, budget, and plan retirement — entirely on your own machine.`
- **Website**: `https://damare42.github.io/ikid/`
- **Topics**: `personal-finance`, `local-first`, `privacy`, `budgeting`,
  `self-hosted`, `sqlite`, `typescript`, `react`, `fire`, `retirement-planning`
- Tick **Releases** off in the sidebar until you actually publish one, so the
  empty section stops looking like a broken promise.

This is the highest-leverage five minutes on the list. "No description,
website, or topics provided" is what a stranger currently sees.

## 4. Security settings

Work through `docs/REPO-SECURITY.md` — it's a checklist, not prose. The three
that matter most on day one, because the repo is *already public*:

- **Secret scanning + push protection** (Settings → Code security). Push
  protection blocks a credential *before* it lands, which is the only fix that
  actually works.
- **Branch protection on `main`** — require a PR and require the `test` and
  `audit` checks. Do this *after* step 1, or the merge gets blocked.
- **Private vulnerability reporting**, so a finder has somewhere to go that
  isn't a public issue.

## 5. Only when you're ready for people to arrive

The site and repo can be live and quietly correct for as long as you like.
Announcing is a separate decision.

Before you post anywhere:

- [ ] `git ls-files database/ uploads/ | grep -v .gitkeep` prints nothing
      (verified clean today — re-check after the merge)
- [ ] Someone who isn't you follows the quick start on a clean machine and
      gets to a dashboard. This is the single most valuable test on the list;
      every project's install instructions work on the author's laptop.
- [ ] `npm audit --omit=dev` is clean
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
