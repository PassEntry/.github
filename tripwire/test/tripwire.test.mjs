import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  checkingBody,
  collapsedBody,
  comment,
  contextFromEnv,
  isValidResult,
  postBody,
  renderResult,
  shouldCollapse,
  tooLargeBody,
  withHeader,
} from '../tripwire.mjs';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

const envFor = (attempt) => ({
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'PassEntry/PassEntry-Frontend',
  GITHUB_REPOSITORY_OWNER: 'PassEntry',
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: String(attempt),
  PR_NUMBER: '1339',
  HEAD_SHA: '9008473a5aaa1111bbbb2222cccc3333dddd4444',
});

function fakeGithub(comments = []) {
  const calls = [];
  const github = {
    rest: {
      issues: {
        createComment: async (args) => {
          calls.push({ method: 'POST', ...args });
          return { data: { id: 4242 } };
        },
        updateComment: async (args) => {
          calls.push({ method: 'PATCH', ...args });
        },
        listComments: 'listComments',
      },
    },
    paginate: async () => comments,
  };
  return { github, calls };
}

const fakeCore = () => {
  const outputs = {};
  return { outputs, setOutput: (key, value) => (outputs[key] = value), warning: () => {} };
};

const context = { repo: { owner: 'PassEntry', repo: 'PassEntry-Frontend' } };

describe('matches the comments the bash version posted', () => {
  for (const c of golden) {
    it(c.name, async () => {
      const ctx = contextFromEnv(envFor(c.attempt ?? 1));
      switch (c.fn) {
        case 'post': {
          const rawResult = 'result' in c ? JSON.stringify(c.result) : c.resultRaw;
          assert.equal(withHeader(postBody({ jobStatus: c.jobStatus, rawResult }, ctx)), c.expected);
          break;
        }
        case 'checking':
          assert.equal(withHeader(checkingBody(ctx)), c.expected);
          break;
        case 'tooLarge':
          assert.equal(withHeader(tooLargeBody(ctx, c.changed)), c.expected);
          break;
        case 'comment': {
          const { github, calls } = fakeGithub();
          const core = fakeCore();
          await comment({ github, context, core, env: envFor(c.attempt) });
          assert.equal(calls[0].body, c.expected);
          assert.equal(core.outputs.comment_id, '4242');
          break;
        }
        case 'collapse': {
          const { github, calls } = fakeGithub(c.comments);
          await comment({ github, context, core: fakeCore(), env: envFor(1) });
          const patches = calls.filter((call) => call.method === 'PATCH');
          assert.deepEqual(
            patches.map((p) => ({ id: p.comment_id, body: p.body })),
            c.expected,
          );
          break;
        }
        default:
          assert.fail(`unknown case ${c.fn}`);
      }
    });
  }
});

const ctx = contextFromEnv(envFor(1));
const risk = (overrides = {}) => ({
  test: 'logs in',
  test_file: 'tests/login.spec.ts',
  test_line: 3,
  test_snippet: "await page.getByTestId('x').click();",
  change_file: 'src/Login.tsx',
  change_line: 9,
  change_snippet: '- a\n+ b',
  why: 'Renamed.',
  confidence: 'high',
  ...overrides,
});
const result = (overrides = {}) => ({
  verdict: 'will_break',
  summary: 'Summary.',
  tests_checked: 1,
  at_risk: [risk()],
  ...overrides,
});

describe('hardening', () => {
  it('uses a longer code fence when a snippet contains backticks', () => {
    const body = renderResult(result({ at_risk: [risk({ change_snippet: '+ const s = ```x```;' })] }), ctx);
    assert.match(body, /````diff\n\+ const s = ```x```;\n````/);
  });

  it('escapes HTML in a collapsed summary', () => {
    const body = collapsedBody(`<!-- e2e-tripwire -->\n# E2E Tripwire\n\n🟡 **1 E2E test might break** for "</summary><img src=x>"`);
    assert.match(body, /<summary>🟡 <b>1 E2E test might break<\/b> for &quot;&lt;\/summary&gt;&lt;img src=x&gt;&quot;<\/summary>/);
  });

  it('reports a failed check when the result has the wrong shape', () => {
    const failed = postBody({ jobStatus: 'failure', rawResult: '' }, ctx);
    for (const bad of [
      null,
      { ...result(), verdict: 'maybe' },
      { ...result(), tests_checked: -1 },
      { ...result(), at_risk: 'none' },
      result({ at_risk: [risk({ confidence: 'low' })] }),
      result({ at_risk: [risk({ test_line: '3' })] }),
      result({ at_risk: [{ ...risk(), why: undefined }] }),
    ]) {
      assert.equal(isValidResult(bad), false, JSON.stringify(bad));
      assert.equal(postBody({ jobStatus: 'success', rawResult: JSON.stringify(bad) }, ctx), failed);
    }
    assert.equal(isValidResult(result()), true);
  });

  it('only collapses its own uncollapsed comments', () => {
    const own = { id: 1, user: { login: 'github-actions[bot]' }, body: '<!-- e2e-tripwire -->\n# E2E Tripwire\n\nx' };
    assert.equal(shouldCollapse(own, 2), true);
    assert.equal(shouldCollapse(own, 1), false);
    assert.equal(shouldCollapse({ ...own, user: { login: 'someone' } }, 2), false);
    assert.equal(shouldCollapse({ ...own, body: 'no marker' }, 2), false);
    assert.equal(shouldCollapse({ ...own, body: `${own.body}\n<details>` }, 2), false);
  });
});
