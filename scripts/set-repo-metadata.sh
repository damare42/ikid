#!/usr/bin/env bash
#
# Step 3 of docs/LAUNCH-RUNBOOK.md — fill in the repo's "About" box.
#
# Right now a stranger landing on github.com/damare42/ikid sees
# "No description, website, or topics provided." Topics in particular are how
# people *find* a repo; without them the project is invisible to GitHub search.
#
# Works three ways, in order of what it finds:
#   1. `gh` CLI, if installed and authenticated   (brew install gh && gh auth login)
#   2. curl + $GITHUB_TOKEN, if that's exported in your shell
#   3. neither — prints the exact values to paste into the web UI
#
# Never asks for a token interactively and never echoes one. If you use the
# token path, export it in your own shell:
#   export GITHUB_TOKEN=...      # classic PAT with `repo` scope, or a
#                                # fine-grained token scoped to this repo
#                                # with Administration: read & write
#
# Safe to re-run: both API paths *replace* the topic list rather than adding
# to it, so dropping a topic here actually removes it from the repo.
set -euo pipefail

REPO="${1:-damare42/ikid}"

DESCRIPTION="Local-first personal finance. Import bank statements, categorise, budget, and plan retirement — entirely on your own machine. No cloud, no bank logins, no telemetry."
HOMEPAGE="https://damare42.github.io/ikid/"

# Max 20 topics; lowercase, digits and hyphens only. Chosen for how people
# actually search: the category, the differentiator, and the stack.
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

topics_json() {
  printf '{"names":['
  local first=1
  for t in "${TOPICS[@]}"; do
    [ $first -eq 1 ] || printf ','
    printf '"%s"' "$t"
    first=0
  done
  printf ']}'
}

manual_instructions() {
  cat <<EOF

Set it by hand instead — takes about a minute, no install:

  1. Open  https://github.com/$REPO
  2. Click the gear icon next to "About" (top right of the page)
  3. Paste each value below, then Save changes

  Description:
$DESCRIPTION

  Website:
$HOMEPAGE

  Topics (paste the whole line — GitHub splits it on the commas):
$(IFS=,; echo "${TOPICS[*]}")

  While you're in that panel: untick "Releases". An empty Releases section
  reads as a broken promise until you actually publish one.

To automate it next time, either:
  brew install gh && gh auth login && ./scripts/set-repo-metadata.sh
or export a token in your shell and re-run:
  export GITHUB_TOKEN=...   # classic PAT with 'repo' scope
EOF
}

echo "Repo:        $REPO"
echo "Homepage:    $HOMEPAGE"
echo "Topics:      ${#TOPICS[@]} — ${TOPICS[*]}"
echo

if command -v gh >/dev/null 2>&1; then
  echo "Using: gh CLI"
  if ! gh auth status >/dev/null 2>&1; then
    echo "gh is installed but not signed in. Run: gh auth login" >&2
    manual_instructions
    exit 1
  fi
  gh repo edit "$REPO" --description "$DESCRIPTION" --homepage "$HOMEPAGE"
  # PUT replaces the whole list, so no add/remove bookkeeping is needed.
  topics_json | gh api --method PUT "repos/$REPO/topics" --input - >/dev/null
  echo "Done. Check it: https://github.com/$REPO"

elif [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "Using: GITHUB_TOKEN from your environment"
  api() {
    curl -fsS -X "$1" \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/$2" --data-binary @- >/dev/null
  }
  # jq isn't guaranteed to be installed, so build the payload with printf and
  # let python handle the escaping of the em dash and quotes in DESCRIPTION.
  python3 -c 'import json,sys; print(json.dumps({"description":sys.argv[1],"homepage":sys.argv[2]}))' \
    "$DESCRIPTION" "$HOMEPAGE" | api PATCH "repos/$REPO"
  topics_json | api PUT "repos/$REPO/topics"
  echo "Done. Check it: https://github.com/$REPO"

else
  echo "Neither the gh CLI nor \$GITHUB_TOKEN was found."
  manual_instructions
  exit 0
fi
