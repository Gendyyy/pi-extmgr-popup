#!/usr/bin/env bash
# Export the conflict resolutions git learned locally (rerere) so the scheduled
# "Upstream sync" workflow replays them instead of failing on the same conflict again.
#
# Usage: resolve an upstream merge conflict once, commit the merge, then run this and
# commit .github/rerere with it.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

cache=".git/rr-cache"
dest=".github/rerere"

if [ ! -d "$cache" ] || [ -z "$(ls -A "$cache")" ]; then
  echo "No rerere cache found. Enable it (git config rerere.enabled true), resolve a merge" >&2
  echo "conflict, and run this script again." >&2
  exit 1
fi

mkdir -p "$dest"
cp -R "$cache/." "$dest/"
git add "$dest"

count="$(find "$dest" -type f | wc -l | tr -d ' ')"
echo "Staged ${count} rerere file(s) under ${dest} — commit them with the resolved merge."
