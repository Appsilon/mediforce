// apply-verdicts — persist triage's batch judgment as labels.
//
// For each verdict, reconcile the issue's `fullstack:` labels to the desired
// { suitability, priority } and (once, on the transition INTO manual) post a
// gracious decline comment. Best-effort per issue: a failed write logs and
// continues, leaving that issue unclassified for the next tick to re-triage.
//
// Reads:  /output/input.json (steps.triage.verdicts), env GITHUB_TOKEN, FULLSTACK_REPO
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const SUITABILITY = { go: 'fullstack:go', 'needs-approval': 'fullstack:needs-approval', manual: 'fullstack:manual' };
const ALL_SUITABILITY = Object.values(SUITABILITY);
const ALL_PRIO = ['fullstack:prio-high', 'fullstack:prio-med', 'fullstack:prio-low'];
const PRIO = { high: 'fullstack:prio-high', med: 'fullstack:prio-med', low: 'fullstack:prio-low' };

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

/** Given current labels + a verdict, compute labels to add / remove. Pure. */
export function reconcile(currentLabels, verdict) {
  const want = new Set();
  const suit = SUITABILITY[verdict.suitability];
  if (suit) want.add(suit);
  if (verdict.suitability !== 'manual' && PRIO[verdict.priority]) want.add(PRIO[verdict.priority]);

  const managed = [...ALL_SUITABILITY, ...ALL_PRIO];
  const add = [...want].filter((l) => !currentLabels.includes(l));
  const remove = managed.filter((l) => currentLabels.includes(l) && !want.has(l));
  const newlyManual = verdict.suitability === 'manual' && !currentLabels.includes(SUITABILITY.manual);
  return { add, remove, newlyManual };
}

function declineComment(verdict) {
  const reason = verdict.reason || 'this needs product/domain judgement an autonomous agent should not make.';
  return `🤖 **mediforce-fullstack**: leaving this one for a human — ${reason}\n\n` +
    'Add the `fullstack:go` label if you\'d like me to attempt it anyway.';
}

async function applyOne(verdict) {
  const issue = await gh(`/repos/${REPO}/issues/${verdict.issueNumber}`);
  const current = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const { add, remove, newlyManual } = reconcile(current, verdict);

  if (add.length > 0) {
    await gh(`/repos/${REPO}/issues/${verdict.issueNumber}/labels`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: add }),
    });
  }
  for (const name of remove) {
    await gh(`/repos/${REPO}/issues/${verdict.issueNumber}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
  if (newlyManual) {
    await gh(`/repos/${REPO}/issues/${verdict.issueNumber}/comments`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: declineComment(verdict) }),
    });
  }
  return { issueNumber: verdict.issueNumber, add, remove, newlyManual };
}

async function main() {
  const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));
  const verdicts = input?.steps?.triage?.verdicts || [];
  const results = [];
  for (const v of verdicts) {
    if (!v || !v.issueNumber || !SUITABILITY[v.suitability]) {
      console.error(`apply-verdicts: skipping malformed verdict ${JSON.stringify(v)}`);
      continue;
    }
    try {
      results.push(await applyOne(v));
    } catch (err) {
      console.error(`apply-verdicts: #${v.issueNumber} failed (will re-triage next tick): ${err.message}`);
    }
  }
  writeFileSync('/output/result.json', JSON.stringify({ applied: results.length, results }));
  console.log(`apply-verdicts: labelled ${results.length}/${verdicts.length} issue(s)`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('apply-verdicts crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
