// claim — set the `fullstack:in-progress` lease on the selected issue.
//
// Runs on both entry points into `implement`: the go path (from `select`) and
// the gate-approval path (from `clarify-approve`). Either way `select` ran, so
// the issue number is at input.steps.select.issueNumber.
//
// FAILS HARD: if we cannot set the lease we must NOT let `implement` proceed on
// an unclaimed issue (that invites duplicate work). A hard failure just means
// the next tick re-selects it. Scripts ignore `continueOnError` anyway.
//
// Reads:  /output/input.json, env GITHUB_TOKEN, FULLSTACK_REPO
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const IN_PROGRESS = 'fullstack:in-progress';
const DROP = ['fullstack:go', 'fullstack:awaiting-human'];

function ghHeaders() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'mediforce-fullstack-bot' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path, init) {
  const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(), ...init });
  // Removing a label that isn't present returns 404 — that's fine, treat as no-op.
  if (!res.ok && !(init?.method === 'DELETE' && res.status === 404)) {
    throw new Error(`GitHub ${res.status} ${init?.method || 'GET'} ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 || res.status === 404 ? null : res.json();
}

async function main() {
  const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));
  const issueNumber = input?.steps?.select?.issueNumber;
  if (!issueNumber) throw new Error('claim: no select.issueNumber in step input');

  await gh(`/repos/${REPO}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: [IN_PROGRESS] }),
  });
  for (const name of DROP) {
    await gh(`/repos/${REPO}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  writeFileSync('/output/result.json', JSON.stringify({ issueNumber, claimed: true }));
  console.log(`claim: leased #${issueNumber}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('claim crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
