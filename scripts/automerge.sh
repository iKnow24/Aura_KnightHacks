#!/usr/bin/env bash
# Auto-merge sweeper, run by .github/workflows/ci.yml. Plain-words version: docs/shipping.md.
#
# For every open PR that is aimed at main and is NOT a draft:
#   1. combine it with the latest main,
#   2. run scripts/check.sh on the combination,
#   3. if green, merge it into main and delete its branch
#      (PRs stacked on that branch are moved onto main first, so they're next in line).
# Repeats until a full pass merges nothing.
#
# Brakes: drafts never merge; AUTOMERGE_PAUSED=true stops everything;
# after FREEZE_AT only PRs labeled "hotfix" merge.
set -uo pipefail
: "${REPO:?}" "${FREEZE_AT:?}"

if [ "${AUTOMERGE_PAUSED:-}" = "true" ]; then
  echo "::notice::Auto-merge is paused (repo variable AUTOMERGE_PAUSED=true)."
  exit 0
fi
frozen=false
if [ "$(date -u +%s)" -ge "$(date -u -d "$FREEZE_AT" +%s)" ]; then
  frozen=true
  echo "::notice::Freeze is on since $FREEZE_AT. Only PRs labeled 'hotfix' will merge."
fi

git config user.name "lumen-ci"
git config user.email "lumen-ci@users.noreply.github.com"

failed=" "   # PRs that failed in this run; don't retry them in the same run
merged_any=false

while :; do
  progress=false
  prs=$(gh pr list --repo "$REPO" --base main --state open --limit 50 \
          --json number,isDraft,headRefName,headRefOid,labels,isCrossRepository \
          --jq 'sort_by(.number) | .[] | select(.isDraft | not) | select(.isCrossRepository | not)
                | [.number, .headRefName, .headRefOid, ([.labels[].name] | index("hotfix") != null)] | @tsv')
  [ -z "$prs" ] && { echo "No ready PRs aimed at main."; break; }

  while IFS=$'\t' read -r num ref sha hotfix; do
    [[ "$failed" == *" $num "* ]] && continue
    if $frozen && [ "$hotfix" != "true" ]; then echo "PR #$num: frozen, skipping."; continue; fi

    echo "::group::PR #$num ($ref @ ${sha:0:7})"
    ok=true
    git fetch -q origin main "$sha" && git checkout -q --detach "$sha" || ok=false
    if $ok && ! git merge -q --no-edit origin/main; then
      echo "::warning::PR #$num conflicts with main. Merge main into $ref and fix the conflict."
      git merge --abort; ok=false
    fi
    if $ok && ! bash scripts/check.sh; then
      echo "::warning::PR #$num fails the checks when combined with the latest main."; ok=false
    fi
    if $ok; then
      # Move PRs stacked on this branch onto main before the branch goes away.
      for child in $(gh pr list --repo "$REPO" --base "$ref" --state open --json number --jq '.[].number'); do
        gh pr edit "$child" --repo "$REPO" --base main && echo "Moved PR #$child onto main."
      done
      # --match-head-commit: if someone pushed while we tested, don't merge the untested commit.
      if gh pr merge "$num" --repo "$REPO" --merge --match-head-commit "$sha"; then
        echo "::notice::Merged PR #$num into main."
        gh api -X DELETE "repos/$REPO/git/refs/heads/$ref" >/dev/null 2>&1 || true
        progress=true; merged_any=true
      else
        ok=false
      fi
    fi
    if ! $ok; then
      failed+="$num "
      # Show it on the PR itself (one red "automerge" line), instead of a red run every 10 minutes.
      gh api -X POST "repos/$REPO/statuses/$sha" -f state=failure -f context=automerge \
        -f description="Not merged: conflicts with or breaks the latest main. See the CI run." \
        -f target_url="${RUN_URL:-}" >/dev/null || true
    fi
    git checkout -q --detach origin/main 2>/dev/null || true
    git clean -qfdx -e node_modules >/dev/null 2>&1 || true
    echo "::endgroup::"
    $progress && break   # main moved: start a fresh pass against the new main
  done <<<"$prs"

  $progress || break
done

# Merges made by this bot don't start CI on main by themselves, so start it once.
if $merged_any; then gh workflow run ci.yml --repo "$REPO" --ref main || true; fi
[ "$failed" = " " ] || echo "::warning::Not merged this run (see above): PR$failed"
