// reset-labels — one-off maintenance: strip fullstack: verdict/parked labels from
// open issues that have NOT reached implementation, so the next pipeline ticks
// re-triage them from scratch. NOT a pipeline step — run it by hand.
//
// Why not FULLSTACK_REASSIGN? With TRIAGE_BATCH_MAX in place, reassign re-collects
// the whole re-judgeable pool every tick and only drains it via obsolete-closes —
// it re-processes the same front-of-list 25 issues instead of advancing. Stripping
// the labels turns those issues back into "brand-new" (no fullstack label), which
// fetch-candidates triages once each and never re-collects (analysed-once), so a
// capped batch genuinely drains the backlog over a few ticks with no reassign.
//
// PRESERVES in-flight / human-owned issues (in-progress, pr-open, awaiting-human,
// ci-failing). Closed issues are untouched (open query only). Idempotent — a
// second run finds nothing to strip.
//
// Run (dry-run preview — the default):
//   GITHUB_TOKEN=… node scripts/reset-labels.mjs
// Apply for real:
//   GITHUB_TOKEN=… DRY_RUN=false node scripts/reset-labels.mjs
//
// Reads: env GITHUB_TOKEN, FULLSTACK_REPO, DRY_RUN

import { labelNames } from './fetch-candidates.mjs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const DRY_RUN = !/^\s*(false|0|no|off)\s*$/i.test(process.env.DRY_RUN || '');

// Verdict + priority + parked labels — safe to strip so the issue re-triages fresh.
export const STRIP = [
  'fullstack:go', 'fullstack:needs-approval', 'fullstack:manual', 'fullstack:obsolete',
  'fullstack:prio-high', 'fullstack:prio-med', 'fullstack:prio-low', 'fullstack:needs-info',
];
// In-flight or human-owned — presence of ANY of these means "leave the whole issue alone".
export const PRESERVE = [
  'fullstack:in-progress', 'fullstack:pr-open', 'fullstack:awaiting-human', 'fullstack:ci-failing',
];

/** The managed labels to remove from one issue, or [] if it must be left as-is. Pure. */
export function labelsToStrip(labels) {
  if (PRESERVE.some((l) => labels.includes(l))) return [];
  return STRIP.filter((l) => labels.includes(l));
}

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

async function main() {
  const collected = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/repos/${REPO}/issues?state=open&per_page=100&page=${page}`);
    for (const i of batch) {
      if (i.pull_request) continue; // the issues endpoint returns PRs too
      collected.push(i);
    }
    if (batch.length < 100) break;
  }

  let reset = 0;
  let preserved = 0;
  for (const issue of collected) {
    const labels = labelNames(issue);
    const strip = labelsToStrip(labels);
    if (strip.length === 0) {
      if (PRESERVE.some((l) => labels.includes(l))) preserved += 1;
      continue;
    }
    console.log(`${DRY_RUN ? '[dry-run] would reset' : 'reset'} #${issue.number}: -[${strip.join(', ')}]`);
    if (DRY_RUN === false) {
      for (const name of strip) {
        await gh(`/repos/${REPO}/issues/${issue.number}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' });
      }
    }
    reset += 1;
  }

  const verb = DRY_RUN ? 'would reset' : 'reset';
  console.log(`\nreset-labels: ${verb} ${reset} issue(s), preserved ${preserved} in-flight/human-owned.`);
  if (DRY_RUN) console.log('reset-labels: DRY-RUN — re-run with DRY_RUN=false to apply.');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('reset-labels crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
