// Behavior tests for the pure logic inside the fullstack scripts.
// Run: node tests/run_tests.mjs   (no secrets/network needed — pure functions only)
import assert from 'node:assert/strict';
import { classifyIssue, summariseLabelEvents, truthyFlag } from '../scripts/fetch-candidates.mjs';
import { reconcile, closeReason } from '../scripts/apply-verdicts.mjs';
import { rankCandidates, priorityOf, isActionable } from '../scripts/select.mjs';
import { labelsToStrip } from '../scripts/reset-labels.mjs';
import { resolveReviewer, buildGateComment } from '../scripts/notify-gate.mjs';
import { reviewOutcome, buildPrBody } from '../scripts/publish.mjs';
import { resolveWaitMinutes } from '../scripts/arm-timer.mjs';
import { classifyRuns, decideNextAction, summariseAnnotations } from '../scripts/check-ci.mjs';
import { withFixHistory } from '../scripts/mark-ci-green.mjs';
import { buildFailedBody } from '../scripts/mark-ci-failed.mjs';

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (err) { fail += 1; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const NOW = new Date('2026-07-01T12:00:00Z').getTime();
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const lbl = (...names) => names.map((name) => ({ name }));

// ---- fetch-candidates.classifyIssue ----
test('new issue with no labels → triage', () => {
  assert.equal(classifyIssue({ labels: [] }, [], NOW, 2, 3).action, 'triage');
});
test('pr-open issue → skip', () => {
  assert.equal(classifyIssue({ labels: lbl('fullstack:pr-open') }, [], NOW, 2, 3).action, 'skip');
});
test('fresh in-progress lease → skip', () => {
  const events = [{ event: 'labeled', label: { name: 'fullstack:in-progress' }, created_at: hoursAgo(0.5) }];
  assert.equal(classifyIssue({ labels: lbl('fullstack:in-progress') }, events, NOW, 2, 3).action, 'skip');
});
test('stale in-progress lease → reclaim', () => {
  const events = [{ event: 'labeled', label: { name: 'fullstack:in-progress' }, created_at: hoursAgo(5) }];
  const d = classifyIssue({ labels: lbl('fullstack:in-progress') }, events, NOW, 2, 3);
  assert.equal(d.action, 'reclaim');
});
test('manual, not edited → skip', () => {
  const events = [{ event: 'labeled', label: { name: 'fullstack:manual' }, created_at: hoursAgo(10) }];
  const issue = { labels: lbl('fullstack:manual'), updated_at: hoursAgo(20) };
  assert.equal(classifyIssue(issue, events, NOW, 2, 3).action, 'skip');
});
test('manual, edited since decline → triage (re-judge)', () => {
  const events = [{ event: 'labeled', label: { name: 'fullstack:manual' }, created_at: hoursAgo(10) }];
  const issue = { labels: lbl('fullstack:manual'), updated_at: hoursAgo(1) };
  assert.equal(classifyIssue(issue, events, NOW, 2, 3).action, 'triage');
});
test('bot-authored manual issue that keeps being edited → skip (no re-triage loop)', () => {
  // Renovate rewrites its "Dependency Dashboard" constantly, bumping updated_at far
  // past the manual label event. The edited-since heuristic latched on and re-triaged
  // it every tick; bot-authored issues must never enter the pipeline.
  const events = [{ event: 'labeled', label: { name: 'fullstack:manual' }, created_at: hoursAgo(10) }];
  const issue = { labels: lbl('fullstack:manual'), updated_at: hoursAgo(1), user: { type: 'Bot' } };
  assert.equal(classifyIssue(issue, events, NOW, 2, 3).action, 'skip');
});
test('bot-authored issue with no labels → skip (never triaged)', () => {
  assert.equal(classifyIssue({ labels: [], user: { type: 'Bot' } }, [], NOW, 2, 3).action, 'skip');
});
test('bot-authored issue is protected even under reassign → skip', () => {
  const events = [{ event: 'labeled', label: { name: 'fullstack:manual' }, created_at: hoursAgo(10) }];
  const issue = { labels: lbl('fullstack:manual'), updated_at: hoursAgo(1), user: { type: 'Bot' } };
  assert.equal(classifyIssue(issue, events, NOW, 2, 3, true).action, 'skip');
});
test('already go-labelled → skip (not re-analysed)', () => {
  assert.equal(classifyIssue({ labels: lbl('fullstack:go') }, [], NOW, 2, 3).action, 'skip');
});
test('attemptCount counts in-progress labelings', () => {
  const events = [
    { event: 'labeled', label: { name: 'fullstack:in-progress' }, created_at: hoursAgo(9) },
    { event: 'labeled', label: { name: 'fullstack:in-progress' }, created_at: hoursAgo(5) },
    { event: 'unlabeled', label: { name: 'fullstack:in-progress' }, created_at: hoursAgo(7) },
  ];
  assert.equal(summariseLabelEvents(events, 'fullstack:in-progress').count, 2);
  assert.equal(classifyIssue({ labels: lbl('fullstack:in-progress') }, events, NOW, 2, 3).attemptCount, 2);
});

// ---- fetch-candidates.classifyIssue: FULLSTACK_REASSIGN escape hatch ----
test('reassign re-judges go / needs-approval / manual → triage', () => {
  const staleManual = [{ event: 'labeled', label: { name: 'fullstack:manual' }, created_at: hoursAgo(10) }];
  const notEdited = { labels: lbl('fullstack:manual'), updated_at: hoursAgo(20) };
  assert.equal(classifyIssue({ labels: lbl('fullstack:go') }, [], NOW, 2, 3, true).action, 'triage');
  assert.equal(classifyIssue({ labels: lbl('fullstack:needs-approval') }, [], NOW, 2, 3, true).action, 'triage');
  assert.equal(classifyIssue(notEdited, staleManual, NOW, 2, 3, true).action, 'triage');
});
test('reassign re-opens needs-info → reopen (strips label, re-triages)', () => {
  assert.equal(classifyIssue({ labels: lbl('fullstack:needs-info') }, [], NOW, 2, 3, true).action, 'reopen');
});
test('reassign never touches in-flight / human-owned states', () => {
  assert.equal(classifyIssue({ labels: lbl('fullstack:pr-open') }, [], NOW, 2, 3, true).action, 'skip');
  assert.equal(classifyIssue({ labels: lbl('fullstack:awaiting-human') }, [], NOW, 2, 3, true).action, 'skip');
  const freshLease = [{ event: 'labeled', label: { name: 'fullstack:in-progress' }, created_at: hoursAgo(0.5) }];
  assert.equal(classifyIssue({ labels: lbl('fullstack:in-progress') }, freshLease, NOW, 2, 3, true).action, 'skip');
});
test('reassign still reclaims a stale lease (self-heal unchanged)', () => {
  const staleLease = [{ event: 'labeled', label: { name: 'fullstack:in-progress' }, created_at: hoursAgo(5) }];
  assert.equal(classifyIssue({ labels: lbl('fullstack:in-progress') }, staleLease, NOW, 2, 3, true).action, 'reclaim');
});
test('reassign off (default): go / needs-info still skip', () => {
  assert.equal(classifyIssue({ labels: lbl('fullstack:go') }, [], NOW, 2, 3, false).action, 'skip');
  assert.equal(classifyIssue({ labels: lbl('fullstack:needs-info') }, [], NOW, 2, 3, false).action, 'skip');
});

// ---- fetch-candidates.truthyFlag (TRIAGE_ONLY / FULLSTACK_REASSIGN coercion) ----
test('truthyFlag: true/1/yes/on (any case, padded) → true', () => {
  for (const v of ['true', 'TRUE', '1', 'yes', 'on', ' On ', '  true  ']) assert.equal(truthyFlag(v), true);
});
test('truthyFlag: unset / empty / false-ish → false', () => {
  for (const v of [undefined, '', 'false', '0', 'no', 'off', '{{TRIAGE_ONLY}}']) assert.equal(truthyFlag(v), false);
});

// ---- apply-verdicts.reconcile ----
test('new go/high → add go + prio-high, nothing to remove', () => {
  const r = reconcile([], { suitability: 'go', priority: 'high' });
  assert.deepEqual(r.add.sort(), ['fullstack:go', 'fullstack:prio-high'].sort());
  assert.deepEqual(r.remove, []);
  assert.equal(r.newlyManual, false);
});
test('re-judge manual → go strips manual + swaps prio', () => {
  const r = reconcile(['fullstack:manual', 'fullstack:prio-low'], { suitability: 'go', priority: 'high' });
  assert.ok(r.add.includes('fullstack:go'));
  assert.ok(r.add.includes('fullstack:prio-high'));
  assert.ok(r.remove.includes('fullstack:manual'));
  assert.ok(r.remove.includes('fullstack:prio-low'));
});
test('newly manual flagged once; already-manual not', () => {
  assert.equal(reconcile([], { suitability: 'manual' }).newlyManual, true);
  assert.equal(reconcile(['fullstack:manual'], { suitability: 'manual' }).newlyManual, false);
});
test('manual carries no priority label', () => {
  const r = reconcile([], { suitability: 'manual', priority: 'high' });
  assert.deepEqual(r.add, ['fullstack:manual']);
});
test('obsolete adds label, no priority', () => {
  const r = reconcile([], { suitability: 'obsolete', priority: 'high' });
  assert.deepEqual(r.add, ['fullstack:obsolete']);
  assert.equal(r.newlyManual, false);
});
test('re-judge needs-approval → obsolete strips verdict + prio', () => {
  const r = reconcile(['fullstack:needs-approval', 'fullstack:prio-med'], { suitability: 'obsolete' });
  assert.ok(r.add.includes('fullstack:obsolete'));
  assert.ok(r.remove.includes('fullstack:needs-approval'));
  assert.ok(r.remove.includes('fullstack:prio-med'));
});

// ---- reset-labels.labelsToStrip ----
test('reset strips verdict + prio + needs-info labels', () => {
  assert.deepEqual(
    labelsToStrip(['fullstack:needs-approval', 'fullstack:prio-med', 'bug']).sort(),
    ['fullstack:needs-approval', 'fullstack:prio-med'].sort(),
  );
  assert.deepEqual(labelsToStrip(['fullstack:manual']), ['fullstack:manual']);
});
test('reset preserves in-flight / human-owned issues wholesale', () => {
  assert.deepEqual(labelsToStrip(['fullstack:in-progress', 'fullstack:prio-high']), []);
  assert.deepEqual(labelsToStrip(['fullstack:pr-open', 'fullstack:go']), []);
  assert.deepEqual(labelsToStrip(['fullstack:awaiting-human']), []);
  assert.deepEqual(labelsToStrip(['fullstack:ci-failing', 'fullstack:needs-approval']), []);
});
test('reset is a no-op on an already-clean issue', () => {
  assert.deepEqual(labelsToStrip(['bug', 'enhancement']), []);
});

// ---- apply-verdicts.closeReason ----
test('closeReason: already-fixed → completed, else not_planned', () => {
  assert.equal(closeReason('already-fixed'), 'completed');
  assert.equal(closeReason('no-longer-applicable'), 'not_planned');
  assert.equal(closeReason('superseded'), 'not_planned');
  assert.equal(closeReason(undefined), 'not_planned');
});

// ---- select ranking ----
test('rankCandidates: priority then oldest', () => {
  const issues = [
    { number: 1, labels: lbl('fullstack:prio-low'), created_at: hoursAgo(100) },
    { number: 2, labels: lbl('fullstack:prio-high'), created_at: hoursAgo(1) },
    { number: 3, labels: lbl('fullstack:prio-high'), created_at: hoursAgo(50) },
  ];
  assert.deepEqual(rankCandidates(issues).map((i) => i.number), [3, 2, 1]);
});
test('priorityOf defaults to low', () => {
  assert.equal(priorityOf([]), 'low');
  assert.equal(priorityOf(['fullstack:prio-med']), 'med');
});
test('isActionable excludes in-progress / assigned', () => {
  assert.equal(isActionable({ labels: lbl('fullstack:go') }), true);
  assert.equal(isActionable({ labels: lbl('fullstack:go', 'fullstack:in-progress') }), false);
  assert.equal(isActionable({ labels: lbl('fullstack:go'), assignee: { login: 'x' } }), false);
});

// ---- notify-gate reviewer resolution ----
test('creator in map → assign creator', () => {
  const r = resolveReviewer('alice', { alice: 'alice@x.com', 'admin-gh': 'admin@x.com' }, 'admin-gh');
  assert.equal(r.reviewerId, 'alice@x.com');
  assert.equal(r.reviewerIsCreator, true);
});
test('creator not in map → admin id looked up from map by login, cc both', () => {
  const r = resolveReviewer('ext-user', { alice: 'alice@x.com', 'admin-gh': 'admin@x.com' }, 'admin-gh');
  assert.equal(r.reviewerId, 'admin@x.com');
  assert.equal(r.reviewerGh, 'admin-gh');
  assert.equal(r.reviewerIsCreator, false);
  const comment = buildGateComment('plan', ['q1'], 'https://app', 'ext-user', r);
  assert.ok(comment.includes('@ext-user'));
  assert.ok(comment.includes('@admin-gh'));
});
test('admin login missing from map → null reviewerId (misconfig guard)', () => {
  const r = resolveReviewer('ext-user', { alice: 'alice@x.com' }, 'admin-gh');
  assert.equal(r.reviewerId, null);
  assert.equal(r.reviewerGh, 'admin-gh');
});

// ---- publish review outcome + body ----
test('reviewOutcome: ship ready, flag FYI, capped-revise draft', () => {
  assert.deepEqual(reviewOutcome({ verdict: 'ship' }, 0, 2), { draft: false, heading: null });
  assert.equal(reviewOutcome({ verdict: 'flag' }, 0, 2).draft, false);
  assert.ok(reviewOutcome({ verdict: 'flag' }, 0, 2).heading.includes('FYI'));
  const capped = reviewOutcome({ verdict: 'revise' }, 2, 2);
  assert.equal(capped.draft, true);
  assert.ok(capped.heading.includes('Must fix'));
});
test('buildPrBody includes prBody, revise log, concerns, footer', () => {
  const body = buildPrBody(
    { prBody: 'Fixes the thing. Closes #1' },
    { verdict: 'flag', concerns: ['Standards: foo.ts:2 — nit'] },
    { reviseLog: ['pass 1: fixed naming'] },
    reviewOutcome({ verdict: 'flag' }, 0, 2),
  );
  assert.ok(body.includes('Closes #1'));
  assert.ok(body.includes('Review & revision history'));
  assert.ok(body.includes('pass 1: fixed naming'));
  assert.ok(body.includes('Standards: foo.ts:2'));
  assert.ok(body.includes('mediforce-fullstack'));
});

// ---- arm-timer wait length ----
test('resolveWaitMinutes: parses positive, falls back otherwise', () => {
  assert.equal(resolveWaitMinutes('20'), 20);
  assert.equal(resolveWaitMinutes(''), 15);
  assert.equal(resolveWaitMinutes('{{CI_WAIT_MINUTES}}'), 15);
  assert.equal(resolveWaitMinutes('0'), 15);
  assert.equal(resolveWaitMinutes(undefined), 15);
});

// ---- check-ci.classifyRuns ----
const run = (status, conclusion) => ({ status, conclusion });
test('classifyRuns: no runs yet → pending', () => {
  assert.equal(classifyRuns([]), 'pending');
});
test('classifyRuns: any running → pending', () => {
  assert.equal(classifyRuns([run('completed', 'success'), run('in_progress', null)]), 'pending');
});
test('classifyRuns: any failing conclusion → failed', () => {
  assert.equal(classifyRuns([run('completed', 'success'), run('completed', 'failure')]), 'failed');
  assert.equal(classifyRuns([run('completed', 'timed_out')]), 'failed');
});
test('classifyRuns: all completed, none failing → passed', () => {
  assert.equal(classifyRuns([run('completed', 'success'), run('completed', 'skipped')]), 'passed');
});

// ---- check-ci.decideNextAction (caps drive the loop) ----
test('decideNextAction: passed → green', () => {
  assert.equal(decideNextAction('passed', 0, 0, 3, 4), 'green');
});
test('decideNextAction: failed under cap → fix, at cap → giveup', () => {
  assert.equal(decideNextAction('failed', 0, 0, 3, 4), 'fix');
  assert.equal(decideNextAction('failed', 2, 0, 3, 4), 'fix');
  assert.equal(decideNextAction('failed', 3, 0, 3, 4), 'giveup');
});
test('decideNextAction: pending under cap → wait, at cap → giveup', () => {
  assert.equal(decideNextAction('pending', 0, 1, 3, 4), 'wait');
  assert.equal(decideNextAction('pending', 0, 3, 3, 4), 'wait');
  assert.equal(decideNextAction('pending', 0, 4, 3, 4), 'giveup');
});
test('summariseAnnotations: trims to path/line/message', () => {
  const a = summariseAnnotations([{ path: 'x.ts', start_line: 3, end_line: 3, annotation_level: 'failure', message: 'boom' }]);
  assert.deepEqual(a, [{ path: 'x.ts', startLine: 3, endLine: 3, level: 'failure', message: 'boom' }]);
});

// ---- PR-body CI history (green + failed) ----
test('withFixHistory: appends once, skips when empty or already present', () => {
  assert.equal(withFixHistory('body', []), 'body');
  assert.equal(withFixHistory('body', undefined), 'body');
  const once = withFixHistory('body', ['round 1: fixed TS2345']);
  assert.ok(once.includes('CI fix history'));
  assert.ok(once.includes('round 1: fixed TS2345'));
  assert.equal(withFixHistory(once, ['round 1: fixed TS2345']), once);
});
test('buildFailedBody: appends history + failing-check summary, idempotent', () => {
  const failing = [{ name: 'typecheck', url: 'https://gh/checks/1' }];
  const body = buildFailedBody('base', ['round 1: tried'], failing, 'exhausted after 3 rounds');
  assert.ok(body.includes('CI fix history'));
  assert.ok(body.includes('CI failing'));
  assert.ok(body.includes('typecheck'));
  assert.ok(body.includes('exhausted after 3 rounds'));
  assert.equal(buildFailedBody(body, ['round 1: tried'], failing, 'exhausted after 3 rounds'), body);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
