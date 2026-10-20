MARKER='<!-- e2e-tripwire -->'
HEADER='# E2E Tripwire'
SHORT_SHA="${HEAD_SHA:0:7}"
RUN_URL="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
RERUN=""
if [ "${GITHUB_RUN_ATTEMPT:-1}" -gt 1 ]; then
  RERUN=" (re-run #$((GITHUB_RUN_ATTEMPT - 1)))"
fi

new_comment() {
  gh api -X POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
    -f body="$MARKER"$'\n'"$HEADER"$'\n\n'"$1" --jq .id
}

set_comment() {
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID" \
    -f body="$MARKER"$'\n'"$HEADER"$'\n\n'"$1" > /dev/null
}

collapse_older() {
  gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --paginate \
    --jq ".[] | select(.body | contains(\"$MARKER\")) | select((.id | tostring) != \"$COMMENT_ID\") | select(.body | contains(\"<details>\") | not) | \"\(.id)\t\(.body | @base64)\"" |
  while IFS=$'\t' read -r id encoded; do
    body=$(printf '%s' "$encoded" | base64 --decode)
    summary=$(printf '%s\n' "$body" | grep -v '^<!-- e2e-tripwire -->' | grep -v '^#' | grep -m1 . || echo "Earlier E2E tripwire check")
    summary=$(printf '%s' "$summary" | sed -E 's/\*\*([^*]+)\*\*/<b>\1<\/b>/g; s/`([^`]+)`/<code>\1<\/code>/g; s/\[([^]]+)\]\(([^)]+)\)/<a href="\2">\1<\/a>/g')
    rest=$(printf '%s\n' "$body" | grep -v '^<!-- e2e-tripwire -->')
    gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" \
      -f body="$MARKER"$'\n'"<details><summary>$summary</summary>"$'\n\n'"$rest"$'\n\n</details>' > /dev/null
  done
}
