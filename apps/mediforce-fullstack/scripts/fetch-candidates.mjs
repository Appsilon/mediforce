// fetch-candidates — list open issues and partition them for the pipeline.
//
// Emits { unclassifiedCount, unclassified[] } where `unclassified` is the set
// of issues that need an LLM triage pass this tick:
//   - brand-new issues carrying no `fullstack:` verdict/lifecycle label
//   - `fullstack:manual` issues edited since they were declined (re-judge-on-edit)
//   - stale `fullstack:in-progress` leases (older than LEASE_TTL_HOURS, no PR) —
//     the lease is released here and the issue re-enters triage (self-heal)
//
// Already-classified actionable issues (`fullstack:go` / `fullstack:needs-approval`)
// are NOT re-analysed — `select` picks them by their stored labels. That is the
// whole point of persisting the verdict: triage's LLM only ever looks once.
//
// Reads:  /output/input.json (unused — cron tick), env GITHUB_TOKEN, FULLSTACK_REPO,
//         LEASE_TTL_HOURS, MAX_ATTEMPTS
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

export const VERDICT_LABELS = ['fullstack:go', 'fullstack:needs-approval', 'fullstack:manual'];
export const LIFECYCLE_LABELS = ['fullstack:in-progress', 'fullstack:awaiting-human', 'fullstack:pr-open', 'fullstack:needs-info'];
const IN_PROGRESS = 'fullstack:in-progress';
const MANUAL = 'fullstack:manual';
const PR_OPEN = 'fullstack:pr-open';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const LEASE_TTL_HOURS = Number(process.env.LEASE_TTL_HOURS || '2');
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || '3');

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

export function labelNames(issue) {
  return (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
}

/** Newest created_at of a `labeled <name>` event, and how many such events exist. */
export function summariseLabelEvents(events, name) {
  let latest = null;
  let count = 0;
  for (const e of events) {
    if (e.event === 'labeled' && e.label && e.label.name === name) {
      count += 1;
      if (!latest || new Date(e.created_at).getTime() > new Date(latest).getTime()) latest = e.created_at;
    }
  }
  return { latestAt: latest, count };
}

/** Decide what to do with one issue given its labels + events. Pure. */
export function classifyIssue(issue, events, nowMs, ttlHours, maxAttempts) {
  const labels = labelNames(issue);
  const has = (l) => labels.includes(l);

  if (has(PR_OPEN) || has('fullstack:needs-info') || has('fullstack:awaiting-human')) {
    return { action: 'skip' };
  }

  const attempts = summariseLabelEvents(events, IN_PROGRESS).count;

  if (has(IN_PROGRESS)) {
    const { latestAt } = summariseLabelEvents(events, IN_PROGRESS);
    const ageHours = latestAt ? (nowMs - new Date(latestAt).getTime()) / 3_600_000 : Infinity;
    if (ageHours > ttlHours) return { action: 'reclaim', attemptCount: attempts };
    return { action: 'skip' };
  }

  if (has(MANUAL)) {
    const { latestAt } = summariseLabelEvents(events, MANUAL);
    // apply-verdicts posts the decline comment ~1s after adding the manual label, which bumps updated_at past the labeled event; ignore that self-write and only re-triage on a genuine later human edit.
    const SELF_DECLINE_GRACE_MS = 120_000;
    const editedSince = latestAt && new Date(issue.updated_at).getTime() - new Date(latestAt).getTime() > SELF_DECLINE_GRACE_MS;
    if (editedSince) return { action: 'triage', attemptCount: attempts };
    return { action: 'skip' };
  }

  if (has('fullstack:go') || has('fullstack:needs-approval')) return { action: 'skip' };

  // No fullstack label at all → brand-new, needs triage.
  return { action: 'triage', attemptCount: attempts };
}

export function toCandidate(issue, attemptCount, maxAttempts) {
  return {
    number: issue.number,
    title: issue.title,
    body: (issue.body || '').slice(0, 4000),
    url: issue.html_url,
    author: (issue.user && issue.user.login) || null,
    labels: labelNames(issue),
    attemptCount,
    poison: attemptCount >= maxAttempts,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

async function main() {
  const collected = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/repos/${REPO}/issues?state=open&per_page=100&page=${page}`);
    for (const i of batch) {
      if (i.pull_request) continue; // issues endpoint returns PRs too
      if (i.assignee) continue; // a human is on it
      collected.push(i);
    }
    if (batch.length < 100) break;
  }

  const nowMs = Date.now();
  const unclassified = [];
  for (const issue of collected) {
    const labels = labelNames(issue);
    const touchesLifecycleOrManual = labels.includes(IN_PROGRESS) || labels.includes(MANUAL);
    // Only issues wearing in-progress / manual need the (rate-limited) events call.
    const events = touchesLifecycleOrManual
      ? await gh(`/repos/${REPO}/issues/${issue.number}/events?per_page=100`)
      : [];
    const decision = classifyIssue(issue, events, nowMs, LEASE_TTL_HOURS, MAX_ATTEMPTS);

    if (decision.action === 'reclaim') {
      // Release the expired lease so the issue re-enters triage.
      await gh(`/repos/${REPO}/issues/${issue.number}/labels/${encodeURIComponent(IN_PROGRESS)}`, { method: 'DELETE' })
        .catch((err) => console.error(`reclaim: failed to drop lease on #${issue.number}: ${err.message}`));
      unclassified.push(toCandidate(issue, decision.attemptCount, MAX_ATTEMPTS));
    } else if (decision.action === 'triage') {
      unclassified.push(toCandidate(issue, decision.attemptCount, MAX_ATTEMPTS));
    }
  }

  writeFileSync('/output/result.json', JSON.stringify({ unclassifiedCount: unclassified.length, unclassified }));
  console.log(`fetch-candidates: ${unclassified.length} issue(s) to triage: ${unclassified.map((x) => '#' + x.number).join(', ') || '(none)'}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('fetch-candidates crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
