You are checking whether a pull request will break any Playwright E2E test.

The app code is in the current directory. The E2E tests are in ./e2e. The PR diff is in ./diff.patch and the changed file list is in ./changed-files.txt. You can only read files and run git show.

Steps:

1. Read ./diff.patch. List every identifier an E2E test could depend on: test ids, selectors, roles and accessible names, routes, API paths, request and response fields, visible copy, feature flags and seed data.
2. Grep ./e2e for each one. Read the matching tests and the helpers, page objects and fixtures they use.
3. Read the full changed files where the diff alone is unclear.
4. Only report a test if you can point at the exact changed line and the exact test line it conflicts with. Mark it high confidence only if you are sure the test will fail. If you are unsure, mark it medium or leave it out.
5. If nothing conflicts, return verdict likely_fine with an empty at_risk list.

Return JSON matching the schema. Set tests_checked to the number of tests you read that touch the changed code. The summary is shown to the PR author. In one or two plain sentences, say what the change touches and why it does or does not affect the E2E tests. Do not mention ./e2e, diff.patch, changed-files.txt or how you checked.

For each at_risk entry:

- test: the test's own title, exactly as written in its test() call, e.g. `rejects wrong password`. If the conflict is in a shared helper, use the helper's function name, e.g. `choosePreset`, and name the tests that call it in why. Never a description or a list.
- One entry per conflicting test line. Do not report the same line twice.
- change_snippet: copy the lines from diff.patch that cause the conflict, keeping their leading `-` and `+`, so both the old and the new line are shown. At most 10 lines.
- test_snippet: the exact line or lines from the test or helper that will fail, copied as written. At most 10 lines.
- why: one or two plain sentences.
