# Pitch Deck Structure

The slide order, framing, and tone rules for the Mediforce deck. This file is
the source of truth for **what slides exist**; the docs listed in `SKILL.md` are
the source of truth for **facts and content**. Do not mix the two.

## Audience and tone

Pharma operations and IT leaders evaluating whether to run a regulated process
with agents in the loop. They are practitioners, not investors.

- Engineer-to-peer register. Concrete nouns, working examples, real constraints.
- No TAM/SAM, fundraising, category creation, or first-mover language.
- Challenges come from missing infrastructure, never from the customer's failures.
- Human-agent collaboration as peers is the through-line of every slide.

## Slide order

| # | Slide | Type | Holds |
|---|-------|------|-------|
| 1 | Title | `lead` | Product name, one-line positioning, date |
| 2 | The work today | content | How a regulated process runs now, and what it costs |
| 3 | Why now | content | What changed that makes agent-run steps viable |
| 4 | What Mediforce is | `lead` | One sentence, then the three nouns: workflow, step, agent |
| 5 | The workflow model | diagram | Steps, executors, transitions — one worked example |
| 6 | Control modes | content | CM0-CM4: who decides, who acts, at each level |
| 7 | Evidence and audit | content | What is recorded per run, and why a validator accepts it |
| 8 | Where it runs | content | Deployment shape, data residency, no-egress option |
| 9 | A real workflow | content | One end-to-end example with its actual inputs and outputs |
| 10 | Getting started | `lead` | The first workflow a team ships, and how long it takes |

## Technical rules

- Marp markdown. Slides separated by `---` on its own line.
- Every slide must fit one 16:9 page. Content overflow is the most common
  failure — when in doubt, cut text.
- At most 6 bullets per slide, at most 12 words per bullet.
- Use `<!-- _class: lead -->` for the slide types marked `lead` above.
- Code and JSON samples: at most 12 lines, and they must be real, valid samples
  copied from the repo rather than invented.
