---
status: living
audience: agents
last_reviewed: 2026-08-19
---

# Doc writing style: caveman

Applies to files an agent loads **every session**: `AGENTS.md`, `CLAUDE.md`,
`skills/**` (`SKILL.md` and its `references/`), and any doc whose frontmatter
declares `audience: agents`. Every token costs context.

Everything else under `docs/` is human-facing prose and exempt — `README.md`,
`concepts/`, `guides/`, `reference/`, `testing/`, ADR narrative. A person reads
those once; terseness there buys nothing and costs comprehension. The
frontmatter `audience` field decides: anything but `agents` is prose.

Frontmatter, naming and link conventions live in
[`../README.md`](../README.md#conventions).

## Canonical prompt

Writing rules from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)
(April 2026). That prompt's session-mode lines govern a chat, not a file — they
are dropped here.

```
Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
```

Instructions stay imperative — every sentence says what to DO, REUSE, or
FOLLOW. See
[`ai-development-process.md`](ai-development-process.md#writing-style-for-instruction-files).

## Before / after

```markdown
Before (34 words):
The `mediforce` CLI should generally be preferred over calling the REST API
directly, because it handles authentication for you. If you find that the
command you need is missing, you can just add it.

After (13 words):
CLI > REST — CLI handles auth. Command missing? Add it in the same task.
```

## Intensity

| Level | Use for |
|---|---|
| Ultra | tables, index rows, cheat sheets |
| Full (default) | rules, skill steps, checklists |
| Lite | multi-step procedures — keep enough grammar to parse on first read |

## Passthrough (never compress)

Frontmatter · code blocks · file paths · URLs · Zod/symbol/variable names ·
numbers · dates · version strings · section headers.

## When to break rule

When terseness breaks comprehension. Reader who can't parse a fragment =
failure mode.
