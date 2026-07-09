// fetch-candidates — list open issues and partition them for the pipeline.
//
// Emits { unclassifiedCount, unclassified[] } where `unclassified` is the set
// of issues that need an LLM triage pass this tick:
//   - brand-new issues carrying no `fullstack:` verdict/lifecycle label
//   - `fullstack:manual` issues edited since they were declined (re-judge-on-edit)
//   - stale `fullstack:in-progress` leases (older than LEASE_TTL_HOURS, no PR) —
//     the lease is released here and the issue re-enters triage (self-heal)
//
// Bot-authored issues (Renovate's "Dependency Dashboard" et al.) are excluded
// wholesale: they are trackers this pipeline never implements, and the bot's
// constant body rewrites bump `updated_at` so the edited-since re-judge below
// would otherwise re-triage them every tick.
//
// Already-classified actionable issues (`fullstack:go` / `fullstack:needs-approval`)
// are NOT re-analysed — `select` picks them by their stored labels. That is the
// whole point of persisting the verdict: triage's LLM only ever looks once.
//
// ESCAPE HATCH: set FULLSTACK_REASSIGN=true (default off) to force a re-judge of
// every issue carrying only a verdict/needs-info label (go / needs-approval /
// manual / needs-info) — it re-enters triage and apply-verdicts overwrites the
// stored verdict. In-flight/human-owned states (in-progress lease, pr-open,
// awaiting-human) are always protected. Because this reads a workflow-global env
// ref, it re-judges the backlog on EVERY tick while enabled — flip it on, let the
// backlog drain over a few ticks (see the batch cap below), then flip it off.
//
// BATCH CAP: triage now clones `main` and verifies each issue against the code,
// so a batch of ~90 backlog issues cannot be judged reliably in one agent call.
// TRIAGE_BATCH_MAX (default 10) caps how many issues are handed to triage per
// tick; the rest carry no verdict and are picked up on the next tick. A big
// reassign backlog therefore drains over several ticks instead of one impossible
// mega-call — steady-state (a handful of new issues) is unaffected. It is a
// {{secret-ref}}, so the cap is tunable without re-registering the workflow.
//
// TRIAGE-ONLY: set TRIAGE_ONLY=true (default off) to run the triage half only —
// classify the batch and persist the verdict labels, then stop before `select`
// picks anything for implementation. Transition expressions cannot read env, so
// the flag is echoed into this step's output as `triageOnly`; the transitions
// off fetch-candidates / apply-verdicts route to done-empty when it is set.
//
// Reads:  /output/input.json (unused — cron tick), env GITHUB_TOKEN, FULLSTACK_REPO,
//         LEASE_TTL_HOURS, MAX_ATTEMPTS, FULLSTACK_REASSIGN, TRIAGE_ONLY, TRIAGE_BATCH_MAX
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

export const VERDICT_LABELS = ['fullstack:go', 'fullstack:needs-approval', 'fullstack:manual'];
export const LIFECYCLE_LABELS = ['fullstack:in-progress', 'fullstack:awaiting-human', 'fullstack:pr-open', 'fullstack:needs-info'];
const IN_PROGRESS = 'fullstack:in-progress';
const MANUAL = 'fullstack:manual';
const PR_OPEN = 'fullstack:pr-open';
const NEEDS_INFO = 'fullstack:needs-info';
const AWAITING_HUMAN = 'fullstack:awaiting-human';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const LEASE_TTL_HOURS = Number(process.env.LEASE_TTL_HOURS || '2');
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || '3');
/** Coerce a string env flag (true/1/yes/on, case-insensitive) to a boolean. Pure. */
export const truthyFlag = (value) => /^\s*(true|1|yes|on)\s*$/i.test(value || '');
const REASSIGN = truthyFlag(process.env.FULLSTACK_REASSIGN);
const TRIAGE_ONLY = truthyFlag(process.env.TRIAGE_ONLY);
const TRIAGE_BATCH_MAX = Number(process.env.TRIAGE_BATCH_MAX || '10');

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

/** Decide what to do with one issue given its labels + events. Pure.
 *  `reassign === true` forces a re-judge of already-verdicted / parked issues. */
export function classifyIssue(issue, events, nowMs, ttlHours, maxAttempts, reassign) {
  // Bot-authored issues (e.g. Renovate's "Dependency Dashboard") are trackers this
  // pipeline never implements, and the bot rewrites them constantly — bumping
  // `updated_at` far past the `fullstack:manual` label event, which latched the
  // edited-since re-judge below into an every-tick triage loop. Never process them.
  if (issue.user && issue.user.type === 'Bot') return { action: 'skip' };

  const labels = labelNames(issue);
  const has = (l) => labels.includes(l);

  // Always protected: an open PR or an open human gate is in-flight work that a
  // reassign must never yank back into triage.
  if (has(PR_OPEN) || has(AWAITING_HUMAN)) return { action: 'skip' };

  const attempts = summariseLabelEvents(events, IN_PROGRESS).count;

  // An active lease is live implementation work; reassign does not interrupt it
  // (only the stale-lease self-heal reclaims, exactly as before).
  if (has(IN_PROGRESS)) {
    const { latestAt } = summariseLabelEvents(events, IN_PROGRESS);
    const ageHours = latestAt ? (nowMs - new Date(latestAt).getTime()) / 3_600_000 : Infinity;
    if (ageHours > ttlHours) return { action: 'reclaim', attemptCount: attempts };
    return { action: 'skip' };
  }

  // Parked for a human. Reassign re-opens it: strip needs-info (a lifecycle label
  // apply-verdicts does not manage), then re-triage.
  if (has(NEEDS_INFO)) {
    if (reassign === true) return { action: 'reopen', attemptCount: attempts };
    return { action: 'skip' };
  }

  if (has(MANUAL)) {
    const { latestAt } = summariseLabelEvents(events, MANUAL);
    // apply-verdicts posts the decline comment ~1s after adding the manual label, which bumps updated_at past the labeled event; ignore that self-write and only re-triage on a genuine later human edit.
    const SELF_DECLINE_GRACE_MS = 120_000;
    const editedSince = latestAt && new Date(issue.updated_at).getTime() - new Date(latestAt).getTime() > SELF_DECLINE_GRACE_MS;
    if (reassign === true || editedSince) return { action: 'triage', attemptCount: attempts };
    return { action: 'skip' };
  }

  if (has('fullstack:go') || has('fullstack:needs-approval')) {
    if (reassign === true) return { action: 'triage', attemptCount: attempts };
    return { action: 'skip' };
  }

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
    const decision = classifyIssue(issue, events, nowMs, LEASE_TTL_HOURS, MAX_ATTEMPTS, REASSIGN);

    if (decision.action === 'reclaim') {
      // Release the expired lease so the issue re-enters triage.
      await gh(`/repos/${REPO}/issues/${issue.number}/labels/${encodeURIComponent(IN_PROGRESS)}`, { method: 'DELETE' })
        .catch((err) => console.error(`reclaim: failed to drop lease on #${issue.number}: ${err.message}`));
      unclassified.push(toCandidate(issue, decision.attemptCount, MAX_ATTEMPTS));
    } else if (decision.action === 'reopen') {
      // Reassign re-opens a parked issue: drop needs-info so apply-verdicts can
      // write a fresh verdict without select's needs-info block stranding it.
      await gh(`/repos/${REPO}/issues/${issue.number}/labels/${encodeURIComponent(NEEDS_INFO)}`, { method: 'DELETE' })
        .catch((err) => console.error(`reopen: failed to drop needs-info on #${issue.number}: ${err.message}`));
      unclassified.push(toCandidate(issue, decision.attemptCount, MAX_ATTEMPTS));
    } else if (decision.action === 'triage') {
      unclassified.push(toCandidate(issue, decision.attemptCount, MAX_ATTEMPTS));
    }
  }

  if (REASSIGN) console.log('fetch-candidates: FULLSTACK_REASSIGN=on — re-judging already-classified issues this tick');
  if (TRIAGE_ONLY) console.log('fetch-candidates: TRIAGE_ONLY=on — will label the batch then stop before select');

  // Cap the batch so triage can clone + verify each issue reliably in one pass.
  // The overflow carries no verdict, so it is re-collected next tick (self-drains).
  const deferred = unclassified.length - TRIAGE_BATCH_MAX;
  const batch = unclassified.slice(0, TRIAGE_BATCH_MAX);
  if (deferred > 0) console.log(`fetch-candidates: capped batch at ${TRIAGE_BATCH_MAX}; ${deferred} issue(s) deferred to a later tick`);

  writeFileSync('/output/result.json', JSON.stringify({ unclassifiedCount: batch.length, unclassified: batch, triageOnly: TRIAGE_ONLY }));
  console.log(`fetch-candidates: ${batch.length} issue(s) to triage: ${batch.map((x) => '#' + x.number).join(', ') || '(none)'}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('fetch-candidates crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
