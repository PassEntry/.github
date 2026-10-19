#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

if [ "$JOB_STATUS" = "cancelled" ]; then
  set_comment "⏹️ **Cancelled check of this PR up to \`$SHORT_SHA\`$RERUN**, a newer push came in. See the latest check below."
  exit 0
fi

E2E_SHA=$(git -C e2e rev-parse HEAD 2>/dev/null || echo main)

if [ "$JOB_STATUS" != "success" ] || [ -z "${RESULT:-}" ] || ! echo "$RESULT" | jq -e . > /dev/null 2>&1; then
  BODY="⚠️ **Could not finish checking this PR up to \`$SHORT_SHA\`$RERUN.** See the run log for details, or 🔁 [run it again]($RUN_URL). This never blocks the PR."
else
  BODY=$(echo "$RESULT" | jq -r --arg sha "$SHORT_SHA" --arg run "$RUN_URL" --arg rerun "$RERUN" \
    --arg app "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/blob/$HEAD_SHA" \
    --arg e2e "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY_OWNER/passentry-e2e/blob/$E2E_SHA" '
    def path: sub("^\\./"; "") | sub("^e2e/"; "");
    def tests($k): "\($k) E2E test\(if $k == 1 then "" else "s" end)";
    ([.at_risk[] | select(.confidence == "high")]) as $high
    | ([.at_risk[] | select(.confidence != "high")]) as $low
    | ($high + $low) as $risks
    | ($risks | length) as $n
    | ($high | length) as $h
    | ($low | length) as $l
    | ("> " + (.summary | gsub("\n"; "\n> "))) as $summary
    | if $n == 0 then
        "✅ **No E2E breakage expected** in this PR up to `\($sha)`\($rerun)\n\n\($summary)\n\n"
        + "<sub>🔍 \(if .tests_checked == 0 then "No E2E tests touch the changed code" else "Checked \(.tests_checked) test\(if .tests_checked == 1 then " that touches" else "s that touch" end) the changed code" end) · 🔁 [Run again](\($run))</sub>"
      else
        (if $h > 0 then "⚠️ **\(tests($h)) likely to break**\(if $l > 0 then ", \($l) more might" else "" end)" else "🟡 **\(tests($l)) might break**" end)
        + " in this PR up to `\($sha)`\($rerun)\n\n\($summary)\n\n"
        + ($risks | map(
            (.change_file | path) as $cf | (.test_file | path) as $tf
            | "### 🟡 Might break \"\(.test)\"\(if .confidence == "high" then "" else " (less certain)" end)\n\n"
            + "**🛠️ The change** ([`\($cf):\(.change_line)`](\($app)/\($cf)#L\(.change_line)))\n"
            + "```diff\n\(.change_snippet)\n```\n\n"
            + "**🧪 The test that will fail** ([`\($tf):\(.test_line)`](\($e2e)/\($tf)#L\(.test_line)))\n"
            + "```ts\n\(.test_snippet)\n```\n\n"
            + "💡 \(.why)\n"
          ) | join("\n"))
        + "\n<sub>🔁 [Run again](\($run))</sub>"
      end
  ')
fi

set_comment "$BODY"
