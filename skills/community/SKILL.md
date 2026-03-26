---
name: community
description: Write short Discord updates for the MediForce community based on rough notes. Produces two versions (short and detailed) following engineer-to-peers tone with no marketing language.
allowed-tools: Read, Write
metadata:
  author: Appsilon
  version: "1.0"
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

## Context: About MediForce

MediForce is an open-source platform for human-AI agent collaboration in pharma and regulated industries. Built by Appsilon (10+ years building data solutions for life sciences).

**The problem:** Pharma companies have AI budgets and mandates but can't execute. Custom builds are expensive, compliance teams block unsanctioned AI (no audit trails, no accountability), and general-purpose AI tools don't fit regulated workflows. There's no standard for how humans and AI agents should collaborate in regulated processes.

**What MediForce is:**
- Infrastructure layer where AI agents work safely within legally compliant, auditable business processes
- Each process step has a configurable autonomy level: Observer (agent watches), Advisor (agent suggests), Drafter (agent does work, human approves), Executor (agent acts autonomously)
- Processes defined as code (TypeScript + Zod schemas) — version-controlled, AI-friendly, auditable
- Container-per-step execution: each agent runs in an isolated Docker container, works on a git repo, outputs are committed and reviewable on GitHub
- Full audit trail: every agent action, human decision, state transition recorded with commit SHAs
- "Golden image" pattern: validated Docker images with pre-approved tools (R, Python, Claude CLI, pharma packages)

**Who's in the community:**
- Domain experts from clinical ops, pharmacovigilance, regulatory, supply chain
- Developers interested in regulated systems and human-AI collaboration
- Compliance professionals guiding GxP-readiness
- People from pharma/biotech/CROs exploring AI adoption

**Community touchpoints:**
- Friday working sessions (3 PM CEST weekly) — open discussions and demos
- Discord for async updates and discussion
- GitHub repo: open issues, PRs, star

We're building in public — no polished product launch, just working code and a clear vision. We want input from people who know these processes firsthand.

## Procedure

### Step 1: Read the user's rough notes

Read the provided notes carefully. Identify the key facts: what was done, what changed, what problem was encountered, what decision was made.

**Expected:** You understand the substance of the update — the specific component, feature, problem, or decision involved.

**On failure:** Ask the user for clarification on what specifically happened or changed.

### Step 2: Write the short version

Write a 2-4 sentence Discord post. Jump straight into what happened. End with a specific question or ask directed at the community.

**Expected:** A concise post that an engineer would find worth reading. No filler, no marketing language.

**On failure:** Re-read the rules below and strip out any adjectives that sell or vague statements.

### Step 3: Write the detailed version

Write a 5-8 sentence Discord post. Cover the same content with more context — the why, the tradeoffs, the next steps. End with a specific question or ask.

**Expected:** A substantive post that could spark a real discussion. Still sounds like an engineer talking to peers.

**On failure:** Check that you haven't inflated minor progress into a big announcement. If the update is small, the detailed version should still be short.

### Step 4: Present both versions

Present the short and detailed versions separated by `---`. Both should stand on their own.

**Expected:** Two self-contained posts the user can copy-paste into Discord.

## Rules for Writing Posts

- **No marketing language.** No "exciting", "thrilled", "game-changing", "revolutionary", "incredible". Zero adjectives that sell. State what was done, why it matters, what's next.
- **Be specific.** Mention the actual thing: the component, the step, the problem solved. Vague is worse than short.
- **Keep it short.** 3-8 sentences max. Discord posts are not blog posts.
- **Sound like an engineer talking to peers**, not a company talking to customers. First person plural ("we") is fine. Casual but substantive.
- **End with a real question or ask.** Not "what do you think?" but something specific that invites an answer worth reading. Examples: "Has anyone dealt with X in their org?", "Would Y be useful for your workflows?", "If you've tried Z, what broke?", "Anyone seen a better approach to X?"
- **No hashtags, no emojis in headers.** One or two emojis inline are fine if natural, but don't decorate.
- **If the update is small, the post should be small.** Don't inflate minor progress into a big announcement.
- **Don't explain what MediForce is** in every post. The audience already knows. Jump straight into what happened or what you're thinking about.
- **It's OK to share problems, not just wins.** "We tried X and it didn't work because Y" is a good post. It's honest and invites help.
- **It's OK to think out loud.** "We're debating between X and Y, here's why it's not obvious..." is engaging and real.

## Validation

- The short version is 2-4 sentences.
- The detailed version is 5-8 sentences.
- Neither version contains marketing language or vague filler.
- Both versions end with a specific, answerable question or ask.
- Both versions can stand alone — no references to each other.

## Common Pitfalls

- **Using marketing adjectives** — scan for "exciting", "thrilled", "game-changing", etc. and remove them.
- **Being vague** — "we made progress on the platform" is worse than "we added container isolation for agent steps".
- **Explaining MediForce from scratch** — the community already knows what MediForce is.
- **Ending with "what do you think?"** — ask something specific that invites a real answer.
- **Inflating small updates** — if you fixed a bug, say you fixed a bug. Don't make it a paragraph.
