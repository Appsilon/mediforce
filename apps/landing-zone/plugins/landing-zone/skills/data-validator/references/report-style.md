# Validation report — visual contract

This document describes the visual and editorial contract for the HTML
validation report rendered by the `data-validator` skill in the Mediforce
Landing Zone workflow. It is the source of truth for what a data manager
sees after a CRO delivery is validated.

The contract is owned by the study team — visual changes go through PRs
on this repository, not on the platform repository. The skill code only
fills marked slots; it does not invent layout or copy.

## Files

- `report-template.html` — the canonical HTML template. Self-contained
  (Tailwind CDN + Google Fonts). Replace only marked slots and blocks.
- `report-style.md` — this file. Guidelines for editors.

## Layout

The report is a single-column page, max-width 5xl (~1024px), with these
sections, in this order, always:

1. **Brand header** — small wordmark + study id, prints with every page.
2. **Status banner** — full-width classification banner.
3. **Header card** — study, delivery, generated timestamp, rules commit.
4. **Key metrics row** — total findings + count by severity (5 cards).
5. **Dataset coverage** — datasets delivered + expected-vs-delivered note.
6. **Classification explainer** — fixed paragraph per classification.
7. **Findings heatmap** — domain x category table (removed if no findings).
8. **Top findings** — top 20 rules by issue count (removed if no findings).
9. **Failure detail** — error + traceback (rendered only on script failure).
10. **Footer** — generation metadata.

Sections must not be reordered, renamed, or added to. If a section has no
data, the block is removed (template uses `<!-- BLOCK:name -->` markers
the skill recognises) — never silently left blank.

## Typography

- Body font: **Inter** (Google Fonts), with `ui-sans-serif` as fallback.
- Numeric values use `font-variant-numeric: tabular-nums` (`.metric-num`
  class) so columns line up.
- Section labels are uppercase, tracked, slate-500.
- Headlines are 2xl, semibold, neutral.

## Colour palette

Status banner colours, by classification:

| Classification | Background       | Text  |
|----------------|------------------|-------|
| `clean`        | `bg-emerald-600` | white |
| `minor-fix`    | `bg-sky-600`     | white |
| `recovery`     | `bg-amber-500`   | white |
| `escalate`     | `bg-red-600`     | white |
| `chaos`        | `bg-zinc-900`    | white |

Severity badge colours (`.severity-*` utility classes in the template):

| Severity | Background       | Text       |
|----------|------------------|------------|
| Critical | `#dc2626` (red)  | white      |
| Major    | `#f59e0b` (amber)| white      |
| Minor    | `#fcd34d` (gold) | slate-800  |
| Warning  | `#fde68a`        | slate-800  |
| Unknown  | `#f1f5f9`        | slate-500  |

Heatmap cell colours scale with count:

| Range   | Class    | Colour            |
|---------|----------|-------------------|
| 0       | `heat-0` | transparent       |
| 1–4     | `heat-1` | `#fef3c7` (cream) |
| 5–19    | `heat-2` | `#fcd34d` (gold)  |
| 20+     | `heat-3` | `#f87171` (red)   |

Card surfaces use white background, slate-200 border, 12px radius, and a
soft shadow.

## Editorial tone

- Plain English. No marketing voice. Reviewer is a data manager.
- Counts, codes, domains, messages — not adjectives. Never say "great"
  or "concerning".
- Times in ISO 8601 UTC.
- Truncate messages over 200 characters with an ellipsis.

## Canonical copy

The five classification banners and explainer paragraphs are fixed copy.
They are defined in the `data-validator` skill (`SKILL.md` of the platform
repository) so the agent does not paraphrase them. Edits to wording must
update both this template and the canonical copy in the skill.

## Iframe constraints

The report renders in a sandboxed iframe on the human-review page.

- No relative URLs — they will not resolve.
- No external scripts beyond the Tailwind CDN.
- No `fetch` or other network calls at runtime.
- All assets (fonts, styles) load from public CDNs.

The Mediforce iframe wrapper toggles a `.dark` class on `<html>` and posts
`{type: 'theme', dark}` messages when the host UI is in dark mode. The
template honours both `prefers-color-scheme: dark` and the explicit
`html.dark` class so cards, borders and muted text stay legible without
forcing the host into light mode.

## Print

Pharma teams print these reports for offline review. The template sets
`print-color-adjust: exact` on the status banner, severity badges and
heatmap cells so colour-coded signals survive the printer driver. The
failure-detail block is `open` by default and the `<summary>` is hidden
in print so the traceback renders inline.

## Changing the template

1. Edit `report-template.html` here on a feature branch.
2. Preview locally by opening the file in a browser — it is fully
   self-contained.
3. Open a PR; the data-manager CODEOWNER reviews.
4. The platform repository ships no template of its own — the skill loads
   this file at runtime from `/workspace/templates/report-template.html`.
