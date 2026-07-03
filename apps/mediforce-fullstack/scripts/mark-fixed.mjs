// mark-fixed — the issue was already resolved by other changes; close it.
//
// Reached when `implement` reports changed=false, reason="already-fixed" with
// evidence. Posts the evidence, closes the issue (reversible — a human reopens
// if wrong), and drops the lease.
//
// Reads:  /output/input.json (steps.implement), env GITHUB_TOKEN, FULLSTACK_REPO
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const IN_PROGRESS = 'fullstack:in-progress';

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

export function fixedComment(evidence) {
  return `🤖 **mediforce-fullstack**: this looks already resolved${evidence ? ` by ${evidence}` : ''} — closing. ` +
    'Reopen if I\'ve got it wrong.';
}

async function main() {
  const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));
  const impl = input?.steps?.implement || {};
  const issueNumber = impl.issueNumber;
  if (!issueNumber) throw new Error('mark-fixed: no implement.issueNumber');

  await gh(`/repos/${REPO}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: fixedComment(impl.evidence) }),
  });
  await gh(`/repos/${REPO}/issues/${issueNumber}/labels/${encodeURIComponent(IN_PROGRESS)}`, { method: 'DELETE' });
  await gh(`/repos/${REPO}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  });

  writeFileSync('/output/result.json', JSON.stringify({ issueNumber, closed: true }));
  console.log(`mark-fixed: closed #${issueNumber} (already fixed)`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('mark-fixed crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
