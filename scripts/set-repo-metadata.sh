#!/usr/bin/env bash
#
# Step 3 of docs/LAUNCH-RUNBOOK.md — fill in the repo's "About" box.
#
# Right now a stranger landing on github.com/damare42/ikid sees
# "No description, website, or topics provided." Topics in particular are how
# people *find* a repo; without them the project is invisible to search.
#
# Requires the GitHub CLI, authenticated as the repo owner:
#   brew install gh && gh auth login
#
# Safe to re-run — every call below overwrites rather than appends.
set -euo pipefail

REPO="${1:-damare42/ikid}"

DESCRIPTION="Local-first personal finance. Import bank statements, categorise, budget, and plan retirement — entirely on your own machine. No cloud, no bank logins, no telemetry."
HOMEPAGE="https://damare42.github.io/ikid/"

# Max 20 topics; lowercase, digits and hyphens only. These are chosen for how
# people actually search: the category, the differentiator, and the stack.
TOPICS=(
  personal-finance
  budgeting
  expense-tracker
  financial-planning
  retirement-planning
  fire
  local-first
  offline-first
  privacy
  self-hosted
  sqlite
  typescript
  react
  nodejs
)

echo "Repo:        $REPO"
echo "Description: $DESCRIPTION"
echo "Homepage:    $HOMEPAGE"
echo "Topics:      ${TOPICS[*]}"
echo

gh repo edit "$REPO" \
  --description "$DESCRIPTION" \
  --homepage "$HOMEPAGE"

# --add-topic is additive; clear first so re-running can't leave stale topics.
existing=$(gh api "repos/$REPO/topics" --jq '.names[]' 2>/dev/null || true)
for t in $existing; do
  case " ${TOPICS[*]} " in
    *" $t "*) ;;                                  # keep — still wanted
    *) gh repo edit "$REPO" --remove-topic "$t" ;; # drop — no longer wanted
  esac
done

for t in "${TOPICS[@]}"; do
  gh repo edit "$REPO" --add-topic "$t"
done

echo
echo "Done. Check it: https://github.com/$REPO"
echo
echo "One thing gh can't do — hiding the empty Releases section. Do that by hand:"
echo "  repo home -> gear icon next to About -> untick 'Releases'"
echo "An empty Releases panel reads as a broken promise until you publish one."
