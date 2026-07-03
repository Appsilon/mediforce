// select — deterministically pick the next issue to work.
//
// Fresh label-filtered query for the actionable pool (`fullstack:go` +
// `fullstack:needs-approval`), so it sees whatever `apply-verdicts` just wrote.
// No LLM here — this is the "don't re-analyse the backlog" payoff. Sort by
// priority (high>med>low) then oldest (FIFO fairness), pick one.
//
// Reads:  env GITHUB_TOKEN, FULLSTACK_REPO
// Writes: /output/result.json → { selected, issueNumber, suitability, priority, title, body, url, author }

import { writeFileSync } from 'node:fs';

const REPO = process.env.FULLSTACK_REPO || 'Appsilon/mediforce';
const BLOCKED = ['fullstack:in-progress', 'fullstack:awaiting-human', 'fullstack:pr-open', 'fullstack:needs-info'];
const PRIO_RANK = { 'fullstack:prio-high': 0, 'fullstack:prio-med': 1, 'fullstack:prio-low': 2 };

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

function labelNames(issue) {
  return (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
}

export function priorityOf(labels) {
  if (labels.includes('fullstack:prio-high')) return 'high';
  if (labels.includes('fullstack:prio-med')) return 'med';
  return 'low';
}

export function priorityRank(labels) {
  for (const [label, rank] of Object.entries(PRIO_RANK)) if (labels.includes(label)) return rank;
  return 3;
}

/** Sort actionable issues: priority asc (high first), then oldest first. Pure. */
export function rankCandidates(issues) {
  return [...issues].sort((a, b) => {
    const la = labelNames(a);
    const lb = labelNames(b);
    return priorityRank(la) - priorityRank(lb) ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

export function isActionable(issue) {
  const labels = labelNames(issue);
  if (BLOCKED.some((l) => labels.includes(l))) return false;
  if (issue.assignee) return false;
  return true;
}

async function main() {
  const pool = new Map();
  for (const label of ['fullstack:go', 'fullstack:needs-approval']) {
    const issues = await gh(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`);
    for (const i of issues) {
      if (i.pull_request) continue;
      if (!isActionable(i)) continue;
      pool.set(i.number, i);
    }
  }

  const ranked = rankCandidates([...pool.values()]);
  if (ranked.length === 0) {
    writeFileSync('/output/result.json', JSON.stringify({ selected: false }));
    console.log('select: nothing actionable this tick');
    return;
  }

  const chosen = ranked[0];
  const labels = labelNames(chosen);
  const suitability = labels.includes('fullstack:go') ? 'go' : 'needs-approval';
  const result = {
    selected: true,
    issueNumber: chosen.number,
    suitability,
    priority: priorityOf(labels),
    title: chosen.title,
    body: (chosen.body || '').slice(0, 4000),
    url: chosen.html_url,
    author: (chosen.user && chosen.user.login) || null,
  };
  writeFileSync('/output/result.json', JSON.stringify(result));
  console.log(`select: #${chosen.number} (${suitability}, ${result.priority})`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('select crashed:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
