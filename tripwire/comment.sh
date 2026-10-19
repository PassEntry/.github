#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

if [ -n "$RERUN" ]; then
  BODY="⏳ **Checking this PR up to \`$SHORT_SHA\` against the E2E suite$RERUN...** This takes a few minutes."
else
  BODY="⏸️ **Waiting 2 min before checking this PR up to \`$SHORT_SHA\`** in case more pushes follow."
fi

COMMENT_ID=$(new_comment "$BODY")
echo "comment_id=$COMMENT_ID" >> "$GITHUB_OUTPUT"
collapse_older || true
