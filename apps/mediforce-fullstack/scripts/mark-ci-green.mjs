// mark-ci-green — CI passed on the PR; acknowledge it and record the fix history.
//
// Reached when `check-ci` routes `green`. Posts a "CI green" comment on the PR
// and, if the loop had to fix anything, appends a "CI fix history" section to
// the PR body so a human reviewer sees what the bot chased. Does NOT touch the
// draft flag: `publish` only drafts on capped-revise (unresolved review
// blockers), and a green CI does not resolve those — un-drafting is a human call.
//
// Reads:  /output/input.json (steps.publish, steps.fix-after-tests, steps.check-ci),
//         env GITHUB_TOKEN, FULLSTACK_REPO
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const HISTORY_MARKER = '### 🔁 CI fix history';

function ghHeaders() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'mediforce-fullstack-bot' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path, init) {
  const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(), ...init });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${init?.method || 'GET'} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** Append a CI-fix-history section to an existing PR body. Idempotent (skips if
 *  already present) and a no-op when nothing was fixed. Pure. */
export function withFixHistory(body, ciFixLog) {
  if (!Array.isArray(ciFixLog) || ciFixLog.length === 0) return body;
  if ((body || '').includes(HISTORY_MARKER)) return body;
  const section = `${HISTORY_MARKER}\n${ciFixLog.map((l) => `- ${l}`).join('\n')}`;
  return `${body || ''}\n\n${section}`;
}

async function main() {
  const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));
  const prNumber = input?.steps?.publish?.prNumber;
  const ciFixLog = input?.steps?.['fix-after-tests']?.ciFixLog;
  if (!prNumber) throw new Error('mark-ci-green: no publish.prNumber');

  const pr = await gh(`/repos/${REPO}/pulls/${prNumber}`);
  const newBody = withFixHistory(pr.body || '', ciFixLog);
  if (newBody !== (pr.body || '')) {
    await gh(`/repos/${REPO}/pulls/${prNumber}`, {
      method: 'PATCH',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: newBody }),
    });
  }

  await gh(`/repos/${REPO}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '🤖 **mediforce-fullstack**: CI is green ✅ — ready for review.' }),
  }).catch((err) => console.error(`mark-ci-green: comment failed: ${err.message}`));

  writeFileSync('/output/result.json', JSON.stringify({ prNumber, ciGreen: true }));
  console.log(`mark-ci-green: PR #${prNumber} CI green`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('mark-ci-green crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
