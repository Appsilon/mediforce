// mark-ci-failed — CI is red (or stuck) and the auto-fix budget is spent; hand
// the PR to a human.
//
// Reached when `check-ci` routes `giveup`. Converts the PR to draft (so it is
// not merged with red CI), appends the CI fix history + the failing-check
// summary to the PR body, labels the issue `fullstack:ci-failing` for
// visibility, and comments what a human needs to pick up. Keeps `fullstack:pr-open`
// (the PR does exist). Best-effort throughout: a failed write leaves the red PR
// as its own signal.
//
// Converting an OPEN PR to draft is not a REST PATCH field — it needs the
// GraphQL `convertPullRequestToDraft` mutation, done here best-effort.
//
// Reads:  /output/input.json (steps.publish, steps.check-ci, steps.fix-after-tests),
//         env GITHUB_TOKEN, FULLSTACK_REPO
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const CI_FAILING = 'fullstack:ci-failing';
const HISTORY_MARKER = '### 🔁 CI fix history';
const FAILING_MARKER = '### ❌ CI failing — needs a human';

function ghHeaders() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'mediforce-fullstack-bot' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path, init) {
  const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(), ...init });
  if (!res.ok && !(init?.method === 'DELETE' && res.status === 404)) {
    throw new Error(`GitHub ${res.status} ${init?.method || 'GET'} ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 || res.status === 404 ? null : res.json();
}

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub GraphQL: ${JSON.stringify(json.errors).slice(0, 200)}`);
  return json.data;
}

/** Append the CI-fix-history + failing-check summary to a PR body. Idempotent,
 *  marker-guarded. Pure. */
export function buildFailedBody(body, ciFixLog, failing, giveupReason) {
  let out = body || '';
  if (Array.isArray(ciFixLog) && ciFixLog.length > 0 && !out.includes(HISTORY_MARKER)) {
    out += `\n\n${HISTORY_MARKER}\n${ciFixLog.map((l) => `- ${l}`).join('\n')}`;
  }
  if (!out.includes(FAILING_MARKER)) {
    const checks = (failing || []).map((f) => `- \`${f.name}\` — ${f.url}`).join('\n') || '- (see the Checks tab)';
    out += `\n\n${FAILING_MARKER}\n${giveupReason || 'CI did not go green.'}\n\n${checks}`;
  }
  return out;
}

export function failedComment(giveupReason, failing) {
  const checks = (failing || []).map((f) => `\`${f.name}\``).join(', ') || 'the failing checks';
  return `🤖 **mediforce-fullstack**: I could not get CI green here — ${giveupReason || 'it stayed red'}. ` +
    `Converted to draft and leaving it for a human; the failing checks are ${checks}. ` +
    'Push a fix (or `/code-review` it) and mark ready when it passes.';
}

async function main() {
  const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));
  const publish = input?.steps?.publish || {};
  const check = input?.steps?.['check-ci'] || {};
  const ciFixLog = input?.steps?.['fix-after-tests']?.ciFixLog;
  const prNumber = publish.prNumber;
  const issueNumber = publish.issueNumber;
  if (!prNumber) throw new Error('mark-ci-failed: no publish.prNumber');

  try {
    const pr = await gh(`/repos/${REPO}/pulls/${prNumber}`);

    if (pr.draft !== true && pr.node_id) {
      await graphql(
        'mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{isDraft}}}',
        { id: pr.node_id },
      ).catch((err) => console.error(`mark-ci-failed: draft conversion failed: ${err.message}`));
    }

    const newBody = buildFailedBody(pr.body || '', ciFixLog, check.failing, check.giveupReason);
    if (newBody !== (pr.body || '')) {
      await gh(`/repos/${REPO}/pulls/${prNumber}`, {
        method: 'PATCH',
        headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newBody }),
      });
    }

    if (issueNumber) {
      await gh(`/repos/${REPO}/issues/${issueNumber}/labels`, {
        method: 'POST',
        headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: [CI_FAILING] }),
      });
    }

    await gh(`/repos/${REPO}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: failedComment(check.giveupReason, check.failing) }),
    });
  } catch (err) {
    console.error(`mark-ci-failed: best-effort failure on PR #${prNumber}: ${err.message}`);
  }

  writeFileSync('/output/result.json', JSON.stringify({ prNumber, issueNumber, ciFailed: true, reason: check.giveupReason || null }));
  console.log(`mark-ci-failed: PR #${prNumber} handed to a human`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('mark-ci-failed crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
