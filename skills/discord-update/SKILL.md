---
name: discord-update
description: Write a Discord update for the MediForce community from rough notes. Use when the user asks for a "Discord update", "Discord post", "community update", "weekly digest for Discord", or hands over bullet-point notes to turn into a community announcement. Produces two versions (short and detailed) in engineer-to-peers tone, no marketing language.
allowed-tools: Read, Write
metadata:
  author: Appsilon
  version: "1.4"
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

Do NOT hardcode product context in this skill — it drifts. If you need background on what MediForce is or who the audience is, read `README.md` (project root) and skim `docs/` (especially `docs/architecture.md`). Pull only what's needed to make the update specific and accurate.

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
- **Perf / DX improvements** → personal benefit framing works well: `I [did X], should [help with reader's day-to-day]:`. Example: `I sped up our e2e tests, should make development more smooth:`. Connects sender → effort → audience benefit in one breath. Beats bare "X is now Y" because it tells the reader why they should care.

If you can't say what a peer *gets* from the change, "Shipped" is a tell that you're announcing a release instead of communicating a benefit. Rewrite from the outcome.

**Expected:** Reads like an engineer telling peers what landed.

**On failure:** Strip selling adjectives and vague verbs. Replace "improved X" with what specifically changed.

### Step 3: Write the detailed version

5-8 sentences worth of content. Still leads with outcome + why. Then adds the context a peer would actually want: defaults / fallback behavior, access info (URL, where credentials live), notable tradeoffs. Surface area (API / CLI / SDK / UI) goes in *only if* it changes what someone integrates with — otherwise it's noise. Optionally close with a question, but only if there's a real one — do NOT bolt one on.

**Use lists, not prose chains, when describing N parallel items.** If you'd write "L1 unit + L2 integration cover logic; L3 API E2E is the foundation; L4 UI E2E stays sparse…", that's a list pretending to be a sentence. Format as numbered or bulleted list — Discord renders it cleanly and a reader can scan in one second. Same for: feature options, supported triggers, levels, tiers, layers, environments.

**Explain mechanisms by their reader-visible consequence.** "Replacing `next dev` JIT with `next start`" is jargon. "Replacing JIT compilation (`next dev`) with pre-building (`next build` + `next start`) so that every page loads faster in tests" lands. Always reach for "so that…" or a parenthetical that says what the reader will notice.

**Cut secondary mechanics ruthlessly.** Anything that doesn't change what the reader does today gets dropped, even if interesting. Cache hit edge cases, opt-in flags for power users, perf footnotes — all noise in a Discord post. Trust the linked PR to carry the long tail.

**Expected:** Substantive post that could spark a real discussion or just informs cleanly. Scannable, with lists where they fit.

**On failure:** If the update is small, the detailed version stays small. Don't pad.

### Step 4: Present both versions

Output short first, then `---`, then detailed. Both stand alone.

## Rules for writing posts

- **Lead with outcome and why. This is the foundation.** Open with what the reader can now do that they couldn't before, or what problem this removes. Mechanics (which layers changed, which files, which dialog) come *after* the outcome — and only when they add signal. If the mechanics aren't load-bearing, cut them.
  - Bad: "We refactored the workflow copy handler across API, CLI, and SDK."
  - Good: "You can now copy any workflow into your own namespace and edit it freely — no fork, no upstream sync to maintain."
- **Discord-safe links.** Bare `#NNN`, `PR #NNN`, `issue #NNN` do NOT auto-link on Discord (only GitHub renders them). Always write `[#NNN](https://github.com/Appsilon/mediforce/pull/NNN)` so the link works in Discord, Slack, blogs, and GitHub alike. Same for external URLs — use `[label](url)`, never bare URLs except for short standalone "Address:" lines.
- **Actionable hook, not passive description.** Tell the reader what *they* can now do or should do, not just "this happens". `Every non-trivial PR drops a bullet` reads like magic; `Every non-trivial PR should add a bullet (we have a /add-changelog-entry skill for that)` invites the reader to participate and points them at the tool.
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
- **Lists beat prose chains.** When you'd otherwise write "A is X; B is Y; C is Z" — that's a list pretending to be a sentence. Use a numbered or bulleted list so a Discord reader can scan it in one second. Especially for: levels, tiers, supported triggers, feature options, layers.
- **Mechanism + reader-visible consequence in the same breath.** Pair every "we changed X to Y" with "so that [thing reader will notice]". Without the consequence clause, you're describing plumbing; with it, you're communicating a benefit.
- **Be ruthless about cutting secondary detail.** If a fact doesn't change what the reader does today, drop it — even if it's interesting. The linked PR carries the long tail. Test: would a peer skim past this line on a busy day? If yes, cut.

## Canonical examples

These three posts are the reference style. New output should feel like these — direct, concrete, no fluff.

> ℹ️ We shipped "Copy workflow to namespace" in PR #359 — full stack: API, CLI, SDK, and a UI dialog with a provenance badge ("Copied from @ns/workflow v3"). Copy creates an independent v1 clone, always private, no upstream sync.

> Just shipped: now Human Task can have several custom defined decision options. Each has configurable label, intent (color), and target step. If these are not defined, workflows will use the default Accept/Revise buttons that we had so far.

> I created a mini app for Landing Zone demos. It runs on the "FTP" server. You can choose a scenario and upload them to the delivery folder in one click. Then simply start a new Landing Zone run.
> Address: http://204.168.165.57:8080/
> Key (need to give it once, then it's stored in your browser): in 1Password

> I sped up our e2e tests, should make development more smooth:
> CI e2e is now ~2x faster — 8.5min → ~4min on a typical source-change PR (#413). The main win is replacing JIT compilation (`next dev`) with pre-building the app (`next build` + `next start`) so that every page loads faster in tests.
>
> Same PR codifies a 5-level testing pyramid in AGENTS.md:
> 1. unit
> 2. integration: verify logic, with mocked database and all services
> 3. API E2E is the foundation — every feature ships with real Next + Firebase emulator HTTP coverage in `e2e/api/` (no browser), mocked agents & external services
> 4. UI E2E — stays sparse, only real multi-step user journeys in `e2e/ui/` (never "is button visible" checks), mocked agents & external services
> 5. external — testing connections with real remote MCP/LLM services etc
>
> [#413](https://github.com/Appsilon/mediforce/pull/413)

### Patterns extracted from the examples

- Opening matches the change type. User-facing feature → `Shipped` / `Just shipped` / `I created`. Process / tooling / internal infra → lead with the outcome (`We now have…`, `You can now…`). Bugfix → `Fixed`. Perf / DX → personal benefit framing (`I sped up X, should [help with day-to-day]:`).
- One-clause feature name in quotes or italics when ambiguous (`"Copy workflow to namespace"`).
- Cite PRs as **clickable markdown links**: `[#359](https://github.com/Appsilon/mediforce/pull/359)`, never bare `PR #359`. (The e2e example above has an inline `(#413)` only because the same PR is also linked properly at the bottom — pick one form per post.)
- **Use lists for N parallel items.** Test levels, tiers, supported triggers, feature options, layers — numbered or bulleted, not prose chains. Each item gets one short clause; cram disambiguators inline (`mocked agents & external services`) rather than spreading them across multiple sentences.
- **Mechanism → consequence pairing.** Don't drop a jargon technical change without the "so that…" clause that tells the reader what they'll notice. "Replacing JIT compilation with pre-building" is half the story; "…so that every page loads faster in tests" is the half that lands.
- Enumerate the surface area when it spans layers: `API, CLI, SDK, and a UI dialog` — only if that matters to the reader.
- Call out defaults / fallback in a separate sentence: "If these are not defined, workflows will use the default Accept/Revise buttons that we had so far."
- For tools / mini-apps: include Address + auth hint (where key lives) on their own lines.
- If the update introduces a process the reader participates in, add a one-clause **hook** pointing them at the tool: "(we have a `/add-changelog-entry` skill for that)".
- No mandatory closing question. Hooks are not questions — they're invitations.
- **Cut secondary details first.** Cache hit edge cases, opt-in flags, perf footnotes, "and also we did X" — drop them. If the reader's daily action doesn't change, the detail isn't earning its line. The PR description carries the long tail.

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
- **Prose-chaining N parallel items.** "L1 unit + L2 integration cover X; L3 is the foundation because Y; L4 stays sparse so Z…" forces the reader to parse a paragraph for what should be a 5-bullet list. Reach for a list whenever the items are parallel and there are ≥3 of them.
- **Dropping mechanism without the consequence.** "Replaced JIT with pre-builds" leaves the reader to guess why it matters. Always include "so that…" or the user-visible effect.
- **Hoarding mechanics that don't change reader behavior.** Cache hit numbers, opt-in env vars, perf footnotes — every line that doesn't change what a peer does on Monday is noise. Trust the PR.
