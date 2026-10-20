import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export const CONFIG = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const { marker: MARKER, header: HEADER, botLogin: BOT_LOGIN, e2eRepo: E2E_REPO, waitSeconds: WAIT_SECONDS } = CONFIG;

export function contextFromEnv(env, e2eSha = 'main') {
  const attempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  const server = env.GITHUB_SERVER_URL;
  return {
    sha: env.HEAD_SHA.slice(0, 7),
    rerun: attempt > 1 ? ` (re-run #${attempt - 1})` : '',
    isRerun: attempt > 1,
    runUrl: `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    appUrl: `${server}/${env.GITHUB_REPOSITORY}/blob/${env.HEAD_SHA}`,
    e2eUrl: `${server}/${E2E_REPO}/blob/${e2eSha}`,
  };
}

export const withHeader = (text) => `${MARKER}\n${HEADER}\n\n${text}`;

const waitText = WAIT_SECONDS % 60 === 0 ? `${WAIT_SECONDS / 60} min` : `${WAIT_SECONDS} sec`;

export const waitingBody = ({ sha }) =>
  `⏸️ **Waiting ${waitText} before checking this PR up to \`${sha}\`** in case more pushes follow.`;

export const checkingBody = ({ sha, rerun }) =>
  `⏳ **Checking this PR up to \`${sha}\` against the E2E suite${rerun}...** This takes a few minutes.`;

export const tooLargeBody = ({ sha, rerun }, changed) =>
  `⚠️ **This PR is too large to check${rerun}** (${changed} changed lines up to \`${sha}\`). Skipped, this never blocks the PR.`;

export const cancelledBody = ({ sha, rerun }) =>
  `⏹️ **Cancelled check of this PR up to \`${sha}\`${rerun}**, a newer push came in. See the latest check below.`;

export const failedBody = ({ sha, rerun, runUrl }) =>
  `⚠️ **Could not finish checking this PR up to \`${sha}\`${rerun}.** See the run log for details, or 🔁 [run it again](${runUrl}). This never blocks the PR.`;

const isText = (value) => typeof value === 'string';
const isCount = (value) => Number.isInteger(value) && value >= 0;

export function isValidResult(result) {
  if (!result || typeof result !== 'object') return false;
  if (!['likely_fine', 'will_break'].includes(result.verdict)) return false;
  if (!isText(result.summary) || !isCount(result.tests_checked) || !Array.isArray(result.at_risk)) return false;
  return result.at_risk.every(
    (risk) =>
      risk &&
      ['test', 'test_file', 'test_snippet', 'change_file', 'change_snippet', 'why'].every((key) => isText(risk[key])) &&
      isCount(risk.test_line) &&
      isCount(risk.change_line) &&
      ['high', 'medium'].includes(risk.confidence),
  );
}

const repoPath = (path) => path.replace(/^\.\//, '').replace(/^e2e\//, '');

const testCount = (count) => `${count} E2E test${count === 1 ? '' : 's'}`;

function codeBlock(language, code) {
  const longestRun = Math.max(0, ...(code.match(/`+/g) || []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

function riskBlock(risk, { appUrl, e2eUrl }) {
  const changeFile = repoPath(risk.change_file);
  const testFile = repoPath(risk.test_file);
  const certainty = risk.confidence === 'high' ? '' : ' (less certain)';
  return (
    `### 🟡 Might break "${risk.test}"${certainty}\n\n` +
    `**🛠️ The change** ([\`${changeFile}:${risk.change_line}\`](${appUrl}/${changeFile}#L${risk.change_line}))\n` +
    `${codeBlock('diff', risk.change_snippet)}\n\n` +
    `**🧪 The test that will fail** ([\`${testFile}:${risk.test_line}\`](${e2eUrl}/${testFile}#L${risk.test_line}))\n` +
    `${codeBlock('ts', risk.test_snippet)}\n\n` +
    `💡 ${risk.why}\n`
  );
}

export function renderResult(result, ctx) {
  const { sha, rerun, runUrl } = ctx;
  const high = result.at_risk.filter((risk) => risk.confidence === 'high');
  const low = result.at_risk.filter((risk) => risk.confidence !== 'high');
  const risks = [...high, ...low];
  const summary = `> ${result.summary.replaceAll('\n', '\n> ')}`;

  if (risks.length === 0) {
    const checked =
      result.tests_checked === 0
        ? 'No E2E tests touch the changed code'
        : `Checked ${result.tests_checked} test${result.tests_checked === 1 ? ' that touches' : 's that touch'} the changed code`;
    return (
      `✅ **No E2E breakage expected** in this PR up to \`${sha}\`${rerun}\n\n${summary}\n\n` +
      `<sub>🔍 ${checked} · 🔁 [Run again](${runUrl})</sub>`
    );
  }

  const headline =
    high.length > 0
      ? `⚠️ **${testCount(high.length)} likely to break**${low.length > 0 ? `, ${low.length} more might` : ''}`
      : `🟡 **${testCount(low.length)} might break**`;
  return (
    `${headline} in this PR up to \`${sha}\`${rerun}\n\n${summary}\n\n` +
    risks.map((risk) => riskBlock(risk, ctx)).join('\n') +
    `\n<sub>🔁 [Run again](${runUrl})</sub>`
  );
}

export function postBody({ jobStatus, rawResult }, ctx) {
  if (jobStatus === 'cancelled') return cancelledBody(ctx);
  let result;
  try {
    result = JSON.parse(rawResult);
  } catch {
    return failedBody(ctx);
  }
  if (jobStatus !== 'success' || !isValidResult(result)) return failedBody(ctx);
  return renderResult(result, ctx);
}

const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function summaryHtml(line) {
  return escapeHtml(line)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export const shouldCollapse = (comment, currentId) =>
  comment.user?.login === BOT_LOGIN &&
  comment.body.includes(MARKER) &&
  comment.id !== currentId &&
  !comment.body.includes('<details>');

export function collapsedBody(body) {
  const lines = body.split('\n').filter((line) => !line.startsWith(MARKER));
  const statusLine = lines.find((line) => line !== '' && !line.startsWith('#'));
  const summary = statusLine ? summaryHtml(statusLine) : 'Earlier E2E tripwire check';
  const rest = lines.join('\n').replace(/\n+$/, '');
  return `${MARKER}\n<details><summary>${summary}</summary>\n\n${rest}\n\n</details>`;
}

export async function config({ core }) {
  const { claude } = CONFIG;
  core.setOutput('e2e_repo', E2E_REPO);
  core.setOutput('wait_seconds', String(WAIT_SECONDS));
  core.setOutput('claude_code_version', claude.codeVersion);
  core.setOutput('model', claude.model);
  core.setOutput('effort', claude.effort);
  core.setOutput('max_turns', String(claude.maxTurns));
  core.setOutput('allowed_tools', claude.allowedTools);
  core.setOutput('disallowed_tools', claude.disallowedTools);
  core.setOutput('result_schema', JSON.stringify(CONFIG.resultSchema));
}

function api(github, context, env) {
  const { owner, repo } = context.repo;
  const issue_number = Number(env.PR_NUMBER);
  return {
    create: async (text) =>
      (await github.rest.issues.createComment({ owner, repo, issue_number, body: withHeader(text) })).data.id,
    update: (commentId, body) => github.rest.issues.updateComment({ owner, repo, comment_id: commentId, body }),
    list: () => github.paginate(github.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 }),
  };
}

export async function comment({ github, context, core, env = process.env }) {
  const ctx = contextFromEnv(env);
  const pr = api(github, context, env);
  const commentId = await pr.create(ctx.isRerun ? checkingBody(ctx) : waitingBody(ctx));
  core.setOutput('comment_id', String(commentId));
  try {
    for (const older of (await pr.list()).filter((c) => shouldCollapse(c, commentId))) {
      await pr.update(older.id, collapsedBody(older.body));
    }
  } catch (error) {
    core.warning(`Could not collapse earlier tripwire comments: ${error.message}`);
  }
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

export async function start({ github, context, core, env = process.env }) {
  const ctx = contextFromEnv(env);
  const pr = api(github, context, env);
  const commentId = Number(env.COMMENT_ID);
  await pr.update(commentId, withHeader(checkingBody(ctx)));

  const range = `origin/${env.BASE_REF}...${env.HEAD_SHA}`;
  const paths = ['--', '.', ...CONFIG.diffExcludes.map((pattern) => `:(exclude)${pattern}`)];
  writeFileSync('diff.patch', git(['diff', range, ...paths]));
  writeFileSync('changed-files.txt', git(['diff', '--name-only', range, ...paths]));
  const changed = git(['diff', '--numstat', range, ...paths])
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => {
      const [added, removed] = line.split('\t');
      return sum + (Number(added) || 0) + (Number(removed) || 0);
    }, 0);

  if (changed > CONFIG.maxChangedLines) {
    await pr.update(commentId, withHeader(tooLargeBody(ctx, changed)));
    core.setOutput('skip', 'true');
  }
}

export async function post({ github, context, env = process.env }) {
  let e2eSha = 'main';
  try {
    e2eSha = git(['-C', 'e2e', 'rev-parse', 'HEAD']).trim();
  } catch {}
  const ctx = contextFromEnv(env, e2eSha);
  const body = postBody({ jobStatus: env.JOB_STATUS, rawResult: env.RESULT || '' }, ctx);
  await api(github, context, env).update(Number(env.COMMENT_ID), withHeader(body));
}
