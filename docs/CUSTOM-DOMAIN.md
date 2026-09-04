# Moving the site to a real domain

Today the site and demo live at `https://damare42.github.io/ikid/`. This moves
them to a domain you own, keeping GitHub Pages as the host.

Nothing about the app changes. This is the site and the demo only — the hosted
app is a separate decision, deliberately deferred (see `docs/ONLINE-PLAN.md`).

**Cost:** the domain, ~$10–15/yr. Pages hosting stays free.
**Time:** about an hour of work, plus up to 24 hours of DNS propagation.
**Reversible:** entirely. Remove the CNAME and revert `site.config.json` and
the old address works again.

---

## 1. Pick a name

The repo and package are `ikid`, so the obvious candidates are built on that.
Nothing below has been checked for availability — DNS lookups aren't possible
from here, so treat these as starting points and check at the registrar.

| Candidate | Notes |
|---|---|
| `ikid.app` | `.app` is on the HSTS preload list, so it is HTTPS-only by definition — a small, real signal for a finance app. Usually ~$14/yr. |
| `ikid.money` / `ikid.cash` | Says the category in the name. Pricier, and slightly novelty. |
| `ikid.dev` | Also HSTS-preloaded. Reads as developer-facing, which undersells it. |
| `ikid.com` | The one people type by default. Almost certainly taken or expensive — check first. |
| `getikid.com` / `useikid.com` | The standard fallbacks when the bare `.com` is gone. They work, and they always look like a fallback. |

Two things worth weighing:

- **`.app` and `.dev` are HSTS-preloaded.** Browsers refuse plain HTTP to them
  outright. For an app whose whole pitch is that it doesn't leak your data,
  that is a free, permanent guarantee rather than a configuration you maintain.
- **Don't pick a name you'd have to abandon later.** Changing domains a second
  time costs the accumulated links and search ranking. If there's any chance
  the project gets renamed, settle that first.

**Where to register:** Cloudflare Registrar sells at wholesale cost with no
first-year discount that expires into a markup, and includes WHOIS privacy.
Porkbun and Namecheap are fine too. Avoid registrars that price the renewal
much higher than the first year.

Register the domain, then keep DNS wherever you registered it — you don't need
a separate DNS provider.

---

## 2. Verify the domain with GitHub *before* pointing it

Do this first. It stops anyone else from ever attaching your domain to their
repository, and it's the step people skip.

1. GitHub → your profile → **Settings** → **Pages** → **Add a domain**.
2. Enter the domain; GitHub gives you a `TXT` record to add.
3. Add it at your registrar, wait a few minutes, click **Verify**.

GitHub explicitly recommends verifying before you add the domain to the
repository, to avoid takeover attacks.

---

## 3. Decide apex or `www`

GitHub recommends `www` even if you also use the apex, because `www` is a
`CNAME` and so survives GitHub changing its server IP addresses; an apex domain
is pinned to four hardcoded A records that you would have to edit by hand.

Configure both and Pages redirects between them automatically. Set the one you
want as canonical in step 4 — that's the one that ends up in `site.config.json`.

**Recommended: `www.<domain>` canonical, apex redirecting to it.**

At your registrar's DNS:

```
# The www subdomain — this is the one that matters.
CNAME   www     damare42.github.io.

# The apex, so bare <domain> also works and redirects to www.
A       @       185.199.108.153
A       @       185.199.109.153
A       @       185.199.110.153
A       @       185.199.111.153
AAAA    @       2606:50c0:8000::153
AAAA    @       2606:50c0:8001::153
AAAA    @       2606:50c0:8002::153
AAAA    @       2606:50c0:8003::153
```

If your registrar supports `ALIAS` or `ANAME` at the apex, one of those
pointing at `damare42.github.io` replaces all eight records above and keeps
working if GitHub's IPs change. Cloudflare's "CNAME flattening" does this.

**Leave room for the app.** Don't use a wildcard record, and don't point the
apex at anything you can't easily change. Keeping `app.<domain>` free costs
nothing now and is the whole reason the hosted-app decision can stay open.

---

## 4. Make the repo agree with the new address

Three edits and one new file. All of them are checked by CI, so a half-finished
move fails the deploy rather than shipping a broken site.

```bash
# 1. Tell Pages which host to serve. Must match site.config.json exactly.
echo "www.example.com" > site/CNAME

# 2. Point the build and every canonical URL at the new address.
#    A custom domain serves from the root, so base becomes "/" — this is what
#    stops every demo asset from 404ing.
$EDITOR site.config.json
#   "origin": "https://www.example.com"
#   "base":   "/"

# 3. Update the absolute URLs in the site's <head>, sitemap and robots.txt.
sed -i '' 's#https://damare42.github.io/ikid/#https://www.example.com/#g' \
  site/index.html site/sitemap.xml site/robots.txt

# 4. Check it before pushing. This is the same check CI runs.
node scripts/verify-site-urls.mjs
npm run build:demo
```

`verify-site-urls.mjs` fails if the CNAME, the config and the URLs disagree —
including the specific case of a custom domain left with a project-path base.
`build:demo` ends by asserting the built HTML actually references
`/demo/assets/`.

Then commit and push. The Pages workflow redeploys on every push to `main`.

---

## 5. Turn on HTTPS

In the repository: **Settings** → **Pages**. The custom domain should already
show as your CNAME. Wait for the certificate to be issued — usually minutes,
occasionally an hour — then tick **Enforce HTTPS**.

Don't skip this. Until it's ticked, the site answers on plain HTTP, and a
finance app served over HTTP undercuts everything the landing page claims.

---

## 6. Verify what a visitor actually gets

```bash
D=www.example.com
curl -sI  "https://$D/" | head -3                     # 200
curl -sI  "http://$D/"  | grep -i location            # redirects to https
curl -sI  "https://example.com/" | grep -i location   # apex → www
curl -s   "https://$D/" | grep -i canonical           # points at the new domain
curl -sI  "https://$D/demo/" | head -1                # 200
curl -s   "https://$D/demo/" | grep -o '/demo/assets/[^"]*' | head -2
```

Then open `https://$D/demo/` in a browser and confirm it renders styled and
loads data. A wrong base path produces a blank white page with 404s in the
console — valid HTML, no server error, nothing in CI to catch it except the
checks above.

Also worth doing:

- Paste the URL into Slack or iMessage and confirm the preview card renders
  (that exercises `og:image`).
- Re-submit `https://$D/sitemap.xml` in Google Search Console, if you use it.

---

## 7. The old address

`damare42.github.io/ikid/` will redirect to the new domain automatically once
the CNAME is in place — GitHub handles this. Existing links keep working.

Leave the redirect alone. Don't disable Pages on the repo, and don't remove the
domain from your GitHub account verification: an unverified domain on a
disabled site is exactly the takeover scenario step 2 was protecting against.

---

## What this does not do

- **The app is still not hosted.** `docs/DEPLOY-ONLINE.md` covers standing it
  up on a server for yourself and invited people; `docs/ONLINE-PLAN.md` covers
  what public sign-ups would require. Neither is blocked by this, and both get
  easier for having the domain in hand.
- **No analytics.** The site still makes no third-party requests, which is the
  claim it makes about itself. Adding a hosted analytics script here would
  contradict the page it's embedded in.
