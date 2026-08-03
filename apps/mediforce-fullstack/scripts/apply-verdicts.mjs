// apply-verdicts — persist triage's batch judgment as labels.
//
// For each verdict, reconcile the issue's `fullstack:` labels to the desired
// { suitability, priority } and (once, on the transition INTO manual) post a
// gracious decline comment. A `needs-approval` verdict also persists triage's
// `blockers` as a marker comment, because the issue is usually selected several
// ticks later, long after triage's step output is gone. An `obsolete` verdict is
// closed here in the same batch pass: label + a comment to the author with
// triage's evidence + a reversible close. Best-effort per issue: a failed write
// logs and continues, leaving that issue unclassified for the next tick to
// re-triage.
//
// TRIAGE-ONLY passthrough: this step re-reads TRIAGE_ONLY and echoes it into its
// output as `triageOnly` so the apply-verdicts -> select transition can route to
// done-empty when the flag is set (transition expressions cannot read env). The
// batch is still labelled first; only the hand-off to `select` is skipped.
//
// Reads:  /output/input.json (steps.triage.verdicts), env GITHUB_TOKEN, FULLSTACK_REPO, TRIAGE_ONLY
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
/** Coerce a string env flag (true/1/yes/on, case-insensitive) to a boolean. Pure. */
export const truthyFlag = (value) => /^\s*(true|1|yes|on)\s*$/i.test(value || '');
const TRIAGE_ONLY = truthyFlag(process.env.TRIAGE_ONLY);
const SUITABILITY = {
  go: 'fullstack:go',
  'needs-approval': 'fullstack:needs-approval',
  manual: 'fullstack:manual',
  obsolete: 'fullstack:obsolete',
};
const ACTIONABLE = new Set(['go', 'needs-approval']);
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
  if (ACTIONABLE.has(verdict.suitability) && PRIO[verdict.priority]) want.add(PRIO[verdict.priority]);

  const managed = [...ALL_SUITABILITY, ...ALL_PRIO];
  const add = [...want].filter((l) => !currentLabels.includes(l));
  const remove = managed.filter((l) => currentLabels.includes(l) && !want.has(l));
  const alreadyManual = currentLabels.includes(SUITABILITY.manual);
  const newlyManual = verdict.suitability === 'manual' && !alreadyManual;
  // Re-declining an issue that is already manual leaves the label in place, so its
  // `labeled` event never moves and fetch-candidates' edited-since clock stays stuck
  // in the past — a genuine edit that re-judges back to manual would loop forever.
  // Flag it so applyOne refreshes the label event (a decline comment is NOT re-posted).
  const restampManual = verdict.suitability === 'manual' && alreadyManual;
  return { add, remove, newlyManual, restampManual };
}

/** Marker on the bot comment that carries triage's blockers. `select` greps for
 *  the same literal to feed them to `draft-plan` — triage's own step output is
 *  long gone by then (the issue is usually selected several ticks later). */
export const BLOCKERS_MARKER = '<!-- fullstack:blockers';

/** Render triage's blockers as a human-readable comment with a machine-readable
 *  tail. `select.parseBlockersComment` is the reader — keep the shapes in sync
 *  (round-tripped in tests). Pure. */
export function blockersComment(blockers) {
  const list = (blockers || []).map((b) => `- \`${b.kind}\` — ${b.question}`).join('\n');
  return '🤖 **mediforce-fullstack**: this one is queued for a plan. Open questions from triage:\n\n' +
    `${list || '- (none recorded)'}\n\n` +
    'I resolve the `missing-context` and `scope` ones myself against the code; only ' +
    '`decision` ones reach a human.\n\n' +
    `${BLOCKERS_MARKER} ${JSON.stringify(blockers || [])} -->`;
}

function declineComment(verdict) {
  const reason = verdict.reason || 'this needs product/domain judgement an autonomous agent should not make.';
  return `🤖 **mediforce-fullstack**: leaving this one for a human — ${reason}\n\n` +
    'Add the `fullstack:go` label if you\'d like me to attempt it anyway.';
}

// `not_planned` for a removed/migrated subsystem; `completed` when a fix already
// shipped (already-fixed) — mirrors mark-fixed's "completed" close.
export function closeReason(category) {
  return category === 'already-fixed' ? 'completed' : 'not_planned';
}

function obsoleteComment(verdict, author) {
  const reason = verdict.reason || 'the code it describes has changed';
  const evidence = verdict.evidence ? ` (${verdict.evidence})` : '';
  const cc = author ? `@${author} ` : '';
  return `${cc}🤖 **mediforce-fullstack**: closing as no longer applicable — ${reason}${evidence}. ` +
    'Reopen if I\'ve got this wrong.';
}

async function applyOne(verdict) {
  const issue = await gh(`/repos/${REPO}/issues/${verdict.issueNumber}`);
  const current = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const { add, remove, newlyManual, restampManual } = reconcile(current, verdict);

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
  if (restampManual) {
    // Refresh the manual label event (remove + re-add) so its timestamp becomes "now",
    // advancing fetch-candidates' edited-since baseline past updated_at. Without this a
    // genuine edit that re-judges back to manual re-triages on every subsequent tick.
    await gh(`/repos/${REPO}/issues/${verdict.issueNumber}/labels/${encodeURIComponent(SUITABILITY.manual)}`, { method: 'DELETE' });
    await gh(`/repos/${REPO}/issues/${verdict.issueNumber}/labels`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: [SUITABILITY.manual] }),
    });
  }
  if (newlyManual) {
    await gh(`/repos/${REPO}/issues/${verdict.issueNumber}/comments`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: declineComment(verdict) }),
    });
  }

  // Persist the blockers so `draft-plan` can work them on a later tick. Update in
  // place rather than appending, so a re-triage (FULLSTACK_REASSIGN) replaces the
  // stale list instead of leaving two contradicting comments on the issue.
  let blockersPosted = false;
  if (verdict.suitability === 'needs-approval') {
    const body = blockersComment(verdict.blockers);
    const comments = await gh(`/repos/${REPO}/issues/${verdict.issueNumber}/comments?per_page=100`);
    const existing = (comments || []).find((c) => (c.body || '').includes(BLOCKERS_MARKER));
    await gh(
      existing
        ? `/repos/${REPO}/issues/comments/${existing.id}`
        : `/repos/${REPO}/issues/${verdict.issueNumber}/comments`,
      {
        method: existing ? 'PATCH' : 'POST',
        headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    blockersPosted = true;
  }

  let closed = false;
  if (verdict.suitability === 'obsolete') {
    const author = (issue.user && issue.user.login) || null;
    await gh(`/repos/${REPO}/issues/${verdict.issueNumber}/comments`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: obsoleteComment(verdict, author) }),
    });
    await gh(`/repos/${REPO}/issues/${verdict.issueNumber}`, {
      method: 'PATCH',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed', state_reason: closeReason(verdict.category) }),
    });
    closed = true;
  }
  return { issueNumber: verdict.issueNumber, add, remove, newlyManual, restampManual, blockersPosted, closed };
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
    // Never auto-close on an unproven obsolete verdict — downgrade to manual so a
    // human sees it instead of it vanishing without evidence.
    if (v.suitability === 'obsolete' && !v.evidence) {
      console.error(`apply-verdicts: #${v.issueNumber} obsolete without evidence — downgrading to manual`);
      v.suitability = 'manual';
      v.reason = `flagged possibly obsolete but without concrete evidence — ${v.reason || 'needs a human to confirm'}`;
    }
    try {
      results.push(await applyOne(v));
    } catch (err) {
      console.error(`apply-verdicts: #${v.issueNumber} failed (will re-triage next tick): ${err.message}`);
    }
  }
  const closedCount = results.filter((r) => r.closed === true).length;
  writeFileSync('/output/result.json', JSON.stringify({ applied: results.length, closed: closedCount, results, triageOnly: TRIAGE_ONLY }));
  console.log(`apply-verdicts: labelled ${results.length}/${verdicts.length} issue(s), closed ${closedCount} as obsolete${TRIAGE_ONLY ? ' — TRIAGE_ONLY=on, stopping before select' : ''}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('apply-verdicts crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
