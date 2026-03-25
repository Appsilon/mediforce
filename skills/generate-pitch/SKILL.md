---
name: generate-pitch
description: Generate a Marp pitch deck (docs/pitch/deck.md) from the product vision and structure definition. Reads PRODUCT_VISION.md, STRUCTURE.md, and theme CSS, then produces a presentation and exports to PDF.
allowed-tools: Read, Write, Bash
metadata:
  author: Appsilon
  version: "1.0"
  domain: product
  complexity: basic
  tags: pitch, presentation, marp
---

# Generate Pitch Deck

## When to Use

- You need to generate or regenerate the Mediforce pitch deck.
- The product vision or deck structure has been updated and the deck needs to reflect changes.
- You want to produce a PDF export of the pitch presentation.

## Inputs

- **Required**: The following files must exist in the repository:
  1. `docs/PRODUCT_VISION.md` — the source content (positioning, messaging, value, target customers, etc.)
  2. `docs/pitch/STRUCTURE.md` — defines slide order, types, tone rules, and content guidance
  3. `docs/pitch/themes/mediforce.css` — available CSS classes and components for the Marp theme

## Procedure

### Step 1: Read all input files

Read all three input files to understand the current product vision, the deck structure, and the available CSS classes.

```
docs/PRODUCT_VISION.md
docs/pitch/STRUCTURE.md
docs/pitch/themes/mediforce.css
```

**Expected:** You have a clear understanding of the content to include, the slide order and types, and the visual components available.

**On failure:** If any file is missing, inform the user and stop. All three files are required.

### Step 2: Generate the deck

Generate `docs/pitch/deck.md` following STRUCTURE.md exactly — slide order, types, tone, and content rules. Pull content from PRODUCT_VISION.md, rewriting it to match the tone and audience defined in STRUCTURE.md.

Ensure every slide fits on one 16:9 page. Keep text concise and follow the technical rules in STRUCTURE.md.

**Expected:** A complete Marp markdown file at `docs/pitch/deck.md` that follows the structure definition and contains accurate content from the product vision.

**On failure:** Review STRUCTURE.md for any slide you missed or any content that overflows. Trim text until every slide fits on one page.

### Step 3: Export to PDF

Run the Marp CLI to export the deck to PDF:

```bash
npx @marp-team/marp-cli --html --allow-local-files --theme ./docs/pitch/themes/mediforce.css ./docs/pitch/deck.md -o ./docs/pitch/deck.pdf
```

**Expected:** A PDF file at `docs/pitch/deck.pdf` with all slides rendered correctly.

**On failure:** Check that `npx` and the Marp CLI package are available. Verify the theme CSS path is correct. Review any Marp CLI error messages.

## Validation

- `docs/pitch/deck.md` exists and follows STRUCTURE.md slide order exactly.
- Every slide fits on one 16:9 page (no content overflow).
- Content is sourced from PRODUCT_VISION.md and rewritten for the deck's target audience.
- `docs/pitch/deck.pdf` is generated without errors.

## Common Pitfalls

- **Using investor language** — never use TAM/SAM, fundraising, category creation, or first-mover language unless STRUCTURE.md explicitly says to.
- **Blaming the customer** — challenges come from missing infrastructure, not from the customer's failures.
- **Losing the central theme** — human-agent collaboration as peers/teammates must be the central theme throughout.
- **Content overflow** — this is the #1 problem. Keep slides concise. When in doubt, cut text.
- **Ignoring STRUCTURE.md** — STRUCTURE.md is the source of truth for what slides exist and how they're framed. PRODUCT_VISION.md is the source of truth for content and facts. Don't mix them up.
