---
name: community
description: Write short Discord updates for the MediForce community based on rough notes. Produces two versions (short and detailed) following engineer-to-peers tone with no marketing language.
allowed-tools: Read, Write
metadata:
  author: Appsilon
  version: "1.2"
  domain: community
  complexity: basic
  tags: discord, community, communication
---

# Write Discord Community Updates

## When to Use

- You need to post a progress update to the MediForce Discord channel.
- You have rough notes about recent work, decisions, or problems and want to turn them into a community post.
- You want to keep the Discord channel active with substantive content.

## Inputs

- **Required**: User's rough notes about recent work, progress, or decisions.

## Product context

Do NOT hardcode product context in this skill — it drifts. If you need background on what MediForce is or who the audience is, read `README.md` (project root) and skim `docs/` (especially `docs/architecture.md`, `docs/features/`). Pull only what's needed to make the update specific and accurate.

In most cases you do NOT need to re-read context: the user's notes already name the concrete component (workflow, step, plugin, CLI command, dialog) and that's enough. Only fetch context when the notes are ambiguous about what was shipped.

## Procedure

### Step 1: Read the user's rough notes

Identify the key facts: what shipped / changed / broke, the specific component or PR, defaults or fallback behavior, any access info (URL, where credentials live).

**Expected:** You can name the exact thing in one phrase.

**On failure:** Ask the user which component or PR they mean.

### Step 2: Write the short version

2-4 sentences. First sentence = **outcome**: what someone in the community can now do, or what pain just got removed. Second sentence (if needed) = **why it matters** in one breath. Mechanics (PR number, surface area, defaults) only if they actually inform — otherwise drop them.

**Pick the opening verb to match the change.**
- User-facing features → `Shipped` / `Just shipped` / `I created`.
- Process / tooling / internal infra → lead with the **outcome itself**, not a "Shipped X" frame. Example: `We now have a weekly CHANGELOG…` reads as something the community gains; `Shipped a weekly CHANGELOG` reads as a release announcement, which is the wrong frame for plumbing.
- Bugfixes → `Fixed`.

If you can't say what a peer *gets* from the change, "Shipped" is a tell that you're announcing a release instead of communicating a benefit. Rewrite from the outcome.

**Expected:** Reads like an engineer telling peers what landed.

**On failure:** Strip selling adjectives and vague verbs. Replace "improved X" with what specifically changed.

### Step 3: Write the detailed version

5-8 sentences. Still leads with outcome + why. Then adds the context a peer would actually want: defaults / fallback behavior, access info (URL, where credentials live), notable tradeoffs. Surface area (API / CLI / SDK / UI) goes in *only if* it changes what someone integrates with — otherwise it's noise. Optionally close with a question, but only if there's a real one — do NOT bolt one on.

**Expected:** Substantive post that could spark a real discussion or just informs cleanly.

**On failure:** If the update is small, the detailed version stays small. Don't pad.

### Step 4: Present both versions

Output short first, then `---`, then detailed. Both stand alone.

## Rules for writing posts

- **Lead with outcome and why. This is the foundation.** Open with what the reader can now do that they couldn't before, or what problem this removes. Mechanics (which layers changed, which files, which dialog) come *after* the outcome — and only when they add signal. If the mechanics aren't load-bearing, cut them.
  - Bad: "We refactored the workflow copy handler across API, CLI, and SDK."
  - Good: "You can now copy any workflow into your own namespace and edit it freely — no fork, no upstream sync to maintain."
- **Discord-safe links.** Bare `#NNN`, `PR #NNN`, `issue #NNN` do NOT auto-link on Discord (only GitHub renders them). Always write `[#NNN](https://github.com/Appsilon/mediforce/pull/NNN)` so the link works in Discord, Slack, blogs, and GitHub alike. Same for external URLs — use `[label](url)`, never bare URLs except for short standalone "Address:" lines.
- **Actionable hook, not passive description.** Tell the reader what *they* can now do or should do, not just "this happens". `Every non-trivial PR drops a bullet` reads like magic; `Every non-trivial PR should add a bullet (we have a /add-release-notes skill for that)` invites the reader to participate and points them at the tool.
- **Active voice + real ownership.** If a human is in the loop, name the actor. "PRs should add a bullet" beats "PRs drop a bullet" — the latter falsely implies automation that doesn't exist.
- **No marketing language.** No "exciting", "thrilled", "game-changing", "revolutionary", "powerful". Zero adjectives that sell.
- **Be specific.** Name the component, the PR, the dialog, the CLI command. Vague is worse than short.
- **Keep it short.** 3-8 sentences. Discord, not a blog.
- **Engineer-to-peers voice.** First person ("I shipped", "we shipped") is fine. Casual but substantive.
- **Questions optional, not mandatory.** Plain ship announcements don't need a question. If you have a real one ("anyone want X next?", "would you use Y?"), ask it; otherwise skip.
- **No hashtags. Emojis sparingly.** One inline emoji (✅, 🚢, 🧪) OK if natural.
- **Small update → small post.** Don't inflate a one-line change into a paragraph.
- **Don't re-explain MediForce.** Audience knows.
- **Problems and tradeoffs are valid posts.** "We tried X, it didn't work because Y" invites help.
- **Practical access info belongs in the post.** Address, port, "key in 1Password" — include them if relevant.

## Canonical examples

These three posts are the reference style. New output should feel like these — direct, concrete, no fluff.

> ℹ️ We shipped "Copy workflow to namespace" in PR #359 — full stack: API, CLI, SDK, and a UI dialog with a provenance badge ("Copied from @ns/workflow v3"). Copy creates an independent v1 clone, always private, no upstream sync.

> Just shipped: now Human Task can have several custom defined decision options. Each has configurable label, intent (color), and target step. If these are not defined, workflows will use the default Accept/Revise buttons that we had so far.

> I created a mini app for Landing Zone demos. It runs on the "FTP" server. You can choose a scenario and upload them to the delivery folder in one click. Then simply start a new Landing Zone run.
> Address: http://204.168.165.57:8080/
> Key (need to give it once, then it's stored in your browser): in 1Password

### Patterns extracted from the examples

- Opening matches the change type. User-facing feature → `Shipped` / `Just shipped` / `I created`. Process / tooling / internal infra → lead with the outcome (`We now have…`, `You can now…`). Bugfix → `Fixed`.
- One-clause feature name in quotes or italics when ambiguous (`"Copy workflow to namespace"`).
- Cite PRs as **clickable markdown links**: `[#359](https://github.com/Appsilon/mediforce/pull/359)`, never bare `PR #359`.
- Enumerate the surface area when it spans layers: `API, CLI, SDK, and a UI dialog` — only if that matters to the reader.
- Call out defaults / fallback in a separate sentence: "If these are not defined, workflows will use the default Accept/Revise buttons that we had so far."
- For tools / mini-apps: include Address + auth hint (where key lives) on their own lines.
- If the update introduces a process the reader participates in, add a one-clause **hook** pointing them at the tool: "(we have a `/add-release-notes` skill for that)".
- No mandatory closing question. Hooks are not questions — they're invitations.

## Validation

- Short version is 2-4 sentences.
- Detailed version is 5-8 sentences (smaller if the update is small).
- Neither has marketing adjectives or vague filler.
- Specific component / PR / dialog named.
- Defaults / fallback behavior stated when relevant.
- Access info (URL, credentials location) included for tools/demos.

## Common pitfalls

- **Leading with mechanics instead of outcome.** "We changed the API, CLI, and SDK" tells the reader nothing they care about. Lead with what now works.
- **Mechanics as filler.** Listing layers / files / handlers only because they exist. Include them only when they change what the reader does.
- **Bare `#NNN` or `PR #NNN`.** Doesn't auto-link on Discord. Always wrap as `[#NNN](https://github.com/Appsilon/mediforce/pull/NNN)`.
- **"Magic happens" passive voice** ("PRs drop a bullet", "the system writes a note") when a human actually does it. Name the actor and use *should*.
- **`Shipped` on process/tooling changes.** Sounds like a release announcement for something that isn't a feature. Lead with the outcome (`We now have…`) instead.
- **Description without a hook** when a process is involved. If the reader can participate (run a skill, file an issue, use a CLI), point them at it in one clause.
- Marketing adjectives ("exciting", "thrilled", "powerful") — strip them.
- Vague verbs ("improved", "enhanced") — name the change.
- Forced closing question on a plain ship post — drop it.
- Re-explaining MediForce — audience already knows.
- Inflating a one-line fix into a paragraph.
- Hardcoding product context that belongs in README — read README/docs at runtime instead.
