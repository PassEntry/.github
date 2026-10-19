#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"
MAX_LINES=5000

set_comment "⏳ **Checking this PR up to \`$SHORT_SHA\` against the E2E suite$RERUN...** This takes a few minutes."

EXCLUDES=(
  ':(exclude)package-lock.json'
  ':(exclude)*.snap'
  ':(exclude)*.lock'
  ':(exclude)dist/**'
  ':(exclude).env*'
)

git diff "origin/$BASE_REF...$HEAD_SHA" -- . "${EXCLUDES[@]}" > diff.patch
git diff --name-only "origin/$BASE_REF...$HEAD_SHA" -- . "${EXCLUDES[@]}" > changed-files.txt

CHANGED=$(git diff --numstat "origin/$BASE_REF...$HEAD_SHA" -- . "${EXCLUDES[@]}" | awk '{s+=$1+$2} END {print s+0}')

if [ "$CHANGED" -gt "$MAX_LINES" ]; then
  set_comment "⚠️ **This PR is too large to check$RERUN** ($CHANGED changed lines up to \`$SHORT_SHA\`). Skipped, this never blocks the PR."
  echo "skip=true" >> "$GITHUB_OUTPUT"
fi
