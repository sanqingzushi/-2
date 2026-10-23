#!/usr/bin/env bash
set -euo pipefail
data_checkout="${RUNNER_TEMP:?}/atlas-monitor-data"
if git show-ref --verify --quiet refs/remotes/origin/monitor-data; then
  git worktree add --detach "$data_checkout" origin/monitor-data
else
  git worktree add --detach "$data_checkout" HEAD
  git -C "$data_checkout" checkout --orphan atlas-monitor-data
  git -C "$data_checkout" rm -rf --ignore-unmatch . >/dev/null
fi
cp data/latest.json "$data_checkout/latest.json"
git -C "$data_checkout" config user.name 'github-actions[bot]'
git -C "$data_checkout" config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git -C "$data_checkout" add latest.json
if ! git -C "$data_checkout" diff --cached --quiet; then
  git -C "$data_checkout" commit -m 'Update timestamped market observation snapshot'
  git -C "$data_checkout" push origin HEAD:refs/heads/monitor-data
fi
