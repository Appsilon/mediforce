// check-ci — read the PR's CI result and ROUTE the loop.
//
// This is the decision node of the CI-fix loop. Transition expressions cannot
// read env/secrets (the evaluator only sees output/variables/verdict), so the
// caps live HERE in JS where `process.env` is readable, and the step emits a
// single `nextAction` the transitions switch on:
//
//   green  -> CI passed                              -> mark-ci-green
//   fix    -> CI failed  and ciRound   < CI_FIX_MAX  -> fix-after-tests
//   wait   -> CI pending and pollCount < CI_POLL_MAX -> arm-timer (re-poll)
//   giveup -> caps exhausted (failed or stuck)       -> mark-ci-failed
//
// The container cannot `pnpm install` to reproduce a failure, so the whole
// point of this step is to HARVEST the real error text from GitHub — failing
// check names, their output summary, and their annotations (file:line:message)
// — and hand it to `fix-after-tests`, which fixes statically from that. CI is
// the reproduction environment; this step is the eyes.
//
// Reads:  /output/input.json (steps.publish, steps.fix-after-tests, steps.check-ci),
//         env GITHUB_TOKEN, FULLSTACK_REPO, CI_FIX_MAX, CI_POLL_MAX
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const CI_FIX_MAX = Number(process.env.CI_FIX_MAX) > 0 ? Number(process.env.CI_FIX_MAX) : 3;
const CI_POLL_MAX = Number(process.env.CI_POLL_MAX) > 0 ? Number(process.env.CI_POLL_MAX) : 4;
const FAILED_CONCLUSIONS = ['failure', 'timed_out', 'cancelled', 'action_required', 'stale'];

function ghHeaders() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'mediforce-fullstack-bot' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Collapse the check-runs list into one raw CI state. Pure.
 *  - no runs yet or any run still running -> 'pending'
 *  - any completed run with a failing conclusion -> 'failed'
 *  - all completed and none failing -> 'passed' */
export function classifyRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return 'pending';
  const failing = runs.filter((r) => r.status === 'completed' && FAILED_CONCLUSIONS.includes(r.conclusion));
  if (failing.length > 0) return 'failed';
  const running = runs.filter((r) => r.status !== 'completed');
  if (running.length > 0) return 'pending';
  return 'passed';
}

/** Route from raw state + counters + caps. Pure. */
export function decideNextAction(raw, ciRound, pollCount, ciFixMax, ciPollMax) {
  if (raw === 'passed') return 'green';
  if (raw === 'failed') return ciRound < ciFixMax ? 'fix' : 'giveup';
  return pollCount < ciPollMax ? 'wait' : 'giveup';
}

/** Trim an annotation list down to what an agent needs to locate the error. Pure. */
export function summariseAnnotations(annotations) {
  return (annotations || []).slice(0, 20).map((a) => ({
    path: a.path,
    startLine: a.start_line,
    endLine: a.end_line,
    level: a.annotation_level,
    message: (a.message || '').slice(0, 600),
  }));
}

async function collectFailing(runs) {
  const failing = runs.filter((r) => r.status === 'completed' && FAILED_CONCLUSIONS.includes(r.conclusion));
  const out = [];
  for (const run of failing) {
    let annotations = [];
    try {
      annotations = summariseAnnotations(await gh(`/repos/${REPO}/check-runs/${run.id}/annotations`));
    } catch (err) {
      console.error(`check-ci: annotations for '${run.name}' failed: ${err.message}`);
    }
    out.push({
      name: run.name,
      conclusion: run.conclusion,
      url: run.html_url,
      title: run.output?.title || null,
      summary: (run.output?.summary || '').slice(0, 1500),
      annotations,
    });
  }
  return out;
}

async function main() {
  const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));
  const publish = input?.steps?.publish || {};
  const prNumber = publish.prNumber;
  const branch = publish.branch;
  if (!prNumber) throw new Error('check-ci: no publish.prNumber in step input');

  const ciRound = Number(input?.steps?.['fix-after-tests']?.ciRound || 0);
  const prev = input?.steps?.['check-ci'];

  const pr = await gh(`/repos/${REPO}/pulls/${prNumber}`);
  const headSha = pr.head?.sha;
  if (!headSha) throw new Error(`check-ci: PR #${prNumber} has no head sha`);

  const checks = await gh(`/repos/${REPO}/commits/${headSha}/check-runs?per_page=100`);
  const runs = checks?.check_runs || [];
  const raw = classifyRuns(runs);

  // Consecutive-pending counter: bounds a stuck CI independently of fix rounds;
  // resets to 0 the moment CI produces a non-pending verdict.
  const pollCount = raw === 'pending'
    ? (prev?.raw === 'pending' ? Number(prev.pollCount || 1) + 1 : 1)
    : 0;

  const nextAction = decideNextAction(raw, ciRound, pollCount, CI_FIX_MAX, CI_POLL_MAX);
  const failing = raw === 'failed' ? await collectFailing(runs) : [];

  let reason;
  if (raw === 'passed') reason = `all ${runs.length} check(s) passed`;
  else if (raw === 'failed') reason = `${failing.map((f) => f.name).join(', ')} failed (round ${ciRound}/${CI_FIX_MAX})`;
  else reason = `CI still running (poll ${pollCount}/${CI_POLL_MAX})`;

  const giveupReason = nextAction === 'giveup'
    ? (raw === 'failed'
      ? `auto-fix exhausted after ${CI_FIX_MAX} round(s); still failing: ${failing.map((f) => f.name).join(', ')}`
      : `CI never completed after ${CI_POLL_MAX} poll(s)`)
    : null;

  writeFileSync('/output/result.json', JSON.stringify({
    prNumber, branch, headSha, raw, nextAction, ciRound, pollCount, failing, reason, giveupReason,
  }));
  console.log(`check-ci: PR #${prNumber} ${raw} -> ${nextAction} (${reason})`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('check-ci crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
