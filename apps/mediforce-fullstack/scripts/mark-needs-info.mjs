// mark-needs-info — park an issue for a human.
//
// Reached from two places:
//   - the gate `reject` verdict (human declined the plan)
//   - `implement` bailing (changed=false, reason="confused"/"broken")
// Swaps the working labels for `fullstack:needs-info` and comments why.
// Best-effort: a failed write just leaves the lease to expire and be reclaimed.
//
// Reads:  /output/input.json (steps.select / steps.implement / steps.clarify-approve),
//         env GITHUB_TOKEN, FULLSTACK_REPO
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const NEEDS_INFO = 'fullstack:needs-info';
const DROP = ['fullstack:in-progress', 'fullstack:awaiting-human'];

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

export function resolveIssueNumber(input) {
  const s = input?.steps || {};
  return s.implement?.issueNumber ?? s.select?.issueNumber ?? null;
}

export function parkComment(input) {
  const s = input?.steps || {};
  const reason = s.implement?.summary || s['clarify-approve']?.guidance;
  return `🤖 **mediforce-fullstack**: parking this pending clarification${reason ? ` — ${reason}` : ''}. ` +
    'Leaving it to a human for now.';
}

async function main() {
  const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));
  const issueNumber = resolveIssueNumber(input);
  if (!issueNumber) throw new Error('mark-needs-info: no issue number in step input');

  try {
    await gh(`/repos/${REPO}/issues/${issueNumber}/labels`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: [NEEDS_INFO] }),
    });
    for (const name of DROP) {
      await gh(`/repos/${REPO}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' });
    }
    await gh(`/repos/${REPO}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: parkComment(input) }),
    });
  } catch (err) {
    console.error(`mark-needs-info: best-effort failure on #${issueNumber}: ${err.message}`);
  }

  writeFileSync('/output/result.json', JSON.stringify({ issueNumber, parked: true }));
  console.log(`mark-needs-info: parked #${issueNumber}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('mark-needs-info crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
