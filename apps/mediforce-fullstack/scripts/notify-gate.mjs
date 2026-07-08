// notify-gate — resolve the reviewer, ping GitHub, hand the issue to a human.
//
// Reviewer selection (tiered, per FULLSTACK_REVIEWER_MAP {githubLogin: email/uid}):
//   1. creator's login IS in the map  -> assign the creator (they own the issue)
//   2. creator's login is NOT in the map (external / non-dev) -> assign the
//      fallback admin, cc BOTH: the creator (fyi) + the admin (pick up)
// FULLSTACK_DEFAULT_ADMIN is the admin's GitHub LOGIN (which MUST be a key in the
// map); their Mediforce id for assignedTo is looked up from the map, and the same
// login is the cc handle — so there is one admin value, not two.
// `reviewerId` is emitted for clarify-approve.assignedTo="${steps.notify-gate.reviewerId}".
//
// Ordering is deliberate: relabel FIRST (needs-approval -> awaiting-human) so the
// issue leaves the selectable pool even if the comment fails; the comment is
// best-effort (it is the only human notification — the platform does not push
// task_assigned — but a missing ping must not strand the relabel).
//
// Reads:  /output/input.json (steps.select, steps.draft-plan), env GITHUB_TOKEN,
//         FULLSTACK_REPO, FULLSTACK_REVIEWER_MAP, FULLSTACK_DEFAULT_ADMIN, APP_BASE_URL
// Writes: /output/result.json

import { readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const NEEDS_APPROVAL = 'fullstack:needs-approval';
const AWAITING_HUMAN = 'fullstack:awaiting-human';

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

/** Resolve reviewer from the map. `adminLogin` is a GitHub login that must be a
 *  key in the map; the map yields its Mediforce id. Pure. */
export function resolveReviewer(creatorLogin, reviewerMap, adminLogin) {
  if (creatorLogin && Object.prototype.hasOwnProperty.call(reviewerMap, creatorLogin)) {
    return { reviewerId: reviewerMap[creatorLogin], reviewerGh: creatorLogin, reviewerIsCreator: true };
  }
  const reviewerId = adminLogin && Object.prototype.hasOwnProperty.call(reviewerMap, adminLogin)
    ? reviewerMap[adminLogin]
    : null;
  return { reviewerId, reviewerGh: adminLogin || null, reviewerIsCreator: false };
}

/** Build the gate comment. Pure. */
export function buildGateComment(plan, questions, appBaseUrl, creatorLogin, resolved) {
  const qlist = (questions || []).map((q) => `- ${q}`).join('\n') || '- (none — confirm the plan)';
  const lines = [
    '🤖 **mediforce-fullstack** wants to attempt this issue, but needs a human sign-off first.',
    '',
    `**Proposed plan:** ${plan || '(see questions)'}`,
    '',
    '**Questions:**',
    qlist,
    '',
    `Review and answer in Mediforce → **Human actions**: ${appBaseUrl || '(APP_BASE_URL not set)'}`,
    '',
  ];
  if (resolved.reviewerIsCreator) {
    lines.push(`cc @${creatorLogin} — you raised this, so it's assigned to you to approve.`);
  } else {
    if (creatorLogin) lines.push(`cc @${creatorLogin} — your issue is being processed.`);
    if (resolved.reviewerGh) {
      lines.push(`cc @${resolved.reviewerGh} — the reporter has no Mediforce account; please pick this up via the link above.`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));
  const select = input?.steps?.select || {};
  const plan = input?.steps?.['draft-plan'] || {};
  const issueNumber = select.issueNumber;
  if (!issueNumber) throw new Error('notify-gate: no select.issueNumber');

  let reviewerMap = {};
  try {
    reviewerMap = JSON.parse(process.env.FULLSTACK_REVIEWER_MAP || '{}');
  } catch (err) {
    console.error(`notify-gate: FULLSTACK_REVIEWER_MAP is not valid JSON: ${err.message}`);
  }
  const resolved = resolveReviewer(select.author, reviewerMap, process.env.FULLSTACK_DEFAULT_ADMIN);
  if (!resolved.reviewerId) {
    console.error('notify-gate: empty reviewer id — is FULLSTACK_DEFAULT_ADMIN a key in FULLSTACK_REVIEWER_MAP? assignedTo would fall back to the run creator (a cron phantom).');
  }

  // 1. Relabel first (hard) — removes the issue from the selectable pool.
  await gh(`/repos/${REPO}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: [AWAITING_HUMAN] }),
  });
  await gh(`/repos/${REPO}/issues/${issueNumber}/labels/${encodeURIComponent(NEEDS_APPROVAL)}`, { method: 'DELETE' });

  // 2. Comment (best-effort) — the actual human ping.
  let commented = false;
  try {
    await gh(`/repos/${REPO}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: buildGateComment(plan.planSummary, plan.questions, process.env.APP_BASE_URL, select.author, resolved) }),
    });
    commented = true;
  } catch (err) {
    console.error(`notify-gate: comment failed (task still created): ${err.message}`);
  }

  writeFileSync('/output/result.json', JSON.stringify({
    issueNumber,
    reviewerId: resolved.reviewerId,
    reviewerIsCreator: resolved.reviewerIsCreator,
    creatorLogin: select.author,
    commented,
  }));
  console.log(`notify-gate: #${issueNumber} → ${resolved.reviewerIsCreator ? 'creator' : 'admin'} (${resolved.reviewerId})`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('notify-gate crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
