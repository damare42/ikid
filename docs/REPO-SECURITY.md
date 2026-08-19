# Repo security & publishing setup

The code-side hardening is done and committed. This is the part **only you can
do** — GitHub settings can't be configured from a file in the repo.

Everything below is free on a personal account with a public repo.

---

## 1. Protect your account first

If your account is compromised, nothing else here matters. An attacker who
controls your GitHub can publish a malicious release that users install.

- [ ] **Two-factor authentication** — Settings → Password and authentication.
      Use an authenticator app or passkey, **not** SMS.
- [ ] **Save your recovery codes** somewhere offline.
- [ ] **Review authorised OAuth apps** and personal access tokens; delete
      anything you don't recognise or no longer use.
- [ ] Prefer **fine-grained PATs** scoped to one repo with an expiry, over
      classic tokens.

## 2. Turn on the free security features

Repo → **Settings → Code security**:

- [ ] **Private vulnerability reporting** — lets people report privately
      instead of opening a public issue. (`SECURITY.md` already points here.)
- [ ] **Dependency graph** — required for the next two.
- [ ] **Dependabot alerts** + **security updates** — the `.github/dependabot.yml`
      in this repo schedules the version bumps; these two produce the alerts.
- [ ] **Secret scanning** + **push protection** — push protection is the
      valuable one: it *blocks* a commit containing a detected credential
      instead of telling you after it's public.
- [ ] **CodeQL** — the workflow is committed (`.github/workflows/codeql.yml`);
      confirm it appears under Code scanning after the first run.

## 3. Protect `main`

Repo → **Settings → Rules → Rulesets** (or Branches → branch protection):

- [ ] Require a pull request before merging
- [ ] Require status checks to pass: **`test`** and **`audit`** (from CI)
- [ ] Require branches to be up to date before merging
- [ ] Block force pushes and deletion of `main`
- [ ] Optional but recommended: **require signed commits** (see §6)

Even solo, this stops a bad local merge or an accidental `git push --force`
from rewriting published history.

## 4. Lock down Actions

Repo → **Settings → Actions → General**:

- [ ] **Actions permissions**: "Allow <you>, and select non-<you> actions" —
      restricts which third-party actions can run.
- [ ] **Workflow permissions**: set to **read-only** by default. The workflows
      here declare exactly what they need (`contents: read`, and
      `contents: write` only for the release job).
- [ ] Uncheck "Allow GitHub Actions to create and approve pull requests".

Why this matters: a compromised action inherits your token. Least privilege
means the blast radius is a failed build, not a published backdoor.

## 5. Publish the website

The site is a single static file — `site/index.html`, no JS, no dependencies.

- [ ] Repo → **Settings → Pages** → Source: **GitHub Actions**
- [ ] Push to `main` — `.github/workflows/pages.yml` deploys it
- [ ] Live at `https://damare42.github.io/ikid/`

**Custom domain** (optional): add your domain under Pages, create a CNAME
record at your registrar pointing to `damare42.github.io`, then tick
**Enforce HTTPS**. Update the `og:url` and `canonical` in `site/index.html`.

The deploy workflow refuses to publish if it finds anything resembling a
private key or a stray data file in `site/`.

## 6. Sign your commits and releases

Signing proves a commit or a binary actually came from you.

```bash
# One-time: create a signing key and tell git to use it
ssh-keygen -t ed25519 -C "signing key"     # or use your existing key
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

Then add the **public** key to GitHub → Settings → SSH and GPG keys → **New
signing key** (not an auth key). Commits show "Verified" afterwards.

## 7. Should the repo move out of your personal account?

Honestly: **not yet.** Moving to an organisation is worth it when you have
collaborators, want per-team permissions, or need the repo to outlive your
personal account. For a solo project, an org adds admin overhead and no real
security.

Do move it if any of these become true:
- Someone else starts contributing regularly
- You want the project to have an identity independent of you
- You start accepting money for it (sponsorship, hosting)

GitHub can transfer a repo to an org later without losing stars, issues, or
history — the URL redirects. So this is a reversible decision you can defer.

**What matters more than org-vs-personal:** 2FA, push protection, branch
protection, and least-privilege Actions. Those are §1–4 above.

## 8. Before you make the repo public / announce it

- [ ] `git ls-files database/ uploads/ | grep -v .gitkeep` prints nothing
      (CI now enforces this on every run)
- [ ] Search history for anything that leaked earlier:
      `git log -p | grep -iE "password|secret|api[_-]key|token" | head`
- [ ] If something *was* committed, rotating the credential is the real fix —
      rewriting history doesn't help once it's been pushed and cloned.
- [ ] Confirm `npm audit --omit=dev` is clean (CI fails on high/critical)
- [ ] Confirm the release workflow builds installers, and that you tell users
      they're unsigned (see `docs/DESKTOP.md`)

## 9. Ongoing

- Dependabot PRs: review weekly, merge the security ones promptly
- CodeQL findings appear under **Security → Code scanning**
- If you ever host a public instance, re-read `docs/GO-PUBLIC.md` — that's a
  different threat model, and it needs legal/consent work this checklist
  doesn't cover
