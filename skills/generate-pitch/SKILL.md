---
name: generate-pitch
description: Generate a Marp pitch deck (docs/pitch/deck.md) from the product vision and this skill's structure definition, then export it to PDF. Use when the deck needs regenerating after a vision or positioning change.
allowed-tools: Read, Write, Bash
metadata:
  author: Appsilon
  version: "2.0"
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

**Content — what the deck says.** Read from the repo docs (`docs/README.md` is
the routing table if any of these have moved):

1. `docs/concepts/vision.md` — positioning, target users, regulatory angle.
2. `README.md` — what the product does, in the words the project actually uses.
3. `docs/concepts/architecture.md` — the package graph, for the technical slides.
4. `docs/adr/README.md` — the decisions behind anything the deck claims.

**Structure and styling — how the deck is shaped.** These ship with the skill,
so the deck can be generated in a fresh checkout with no scaffolding:

5. `skills/generate-pitch/references/structure.md` — slide order, types, tone rules.
6. `skills/generate-pitch/references/theme.css` — the Marp theme.

## Procedure

### Step 1: Read the inputs

Read the four content docs and the two skill references.

**Expected:** You know the slide order and available styles, and you have the
product facts to fill them from the docs rather than from memory.

**On failure:** If a content doc is missing, check `docs/README.md` for its
current location before telling the user it is gone.

### Step 2: Generate the deck

Write `docs/pitch/deck.md` following `references/structure.md` exactly — slide
order, types, tone, and content rules. Pull facts from the content docs,
rewriting them for the audience defined in the structure file.

Ensure every slide fits on one 16:9 page.

**Expected:** A complete Marp markdown file at `docs/pitch/deck.md`.

**On failure:** Review the structure file for any slide you missed or content
that overflows. Trim text until every slide fits on one page.

### Step 3: Export to PDF

```bash
npx @marp-team/marp-cli --html --allow-local-files \
  --theme ./skills/generate-pitch/references/theme.css \
  ./docs/pitch/deck.md -o ./docs/pitch/deck.pdf
```

**Expected:** A PDF at `docs/pitch/deck.pdf` with all slides rendered correctly.

**On failure:** Check that `npx` and the Marp CLI package are available, and
review the Marp CLI error messages.

## Validation

- `docs/pitch/deck.md` exists and follows the structure file's slide order exactly.
- Every slide fits on one 16:9 page (no content overflow).
- Every factual claim traces to one of the content docs.
- `docs/pitch/deck.pdf` is generated without errors.

## Common Pitfalls

- **Using investor language** — never use TAM/SAM, fundraising, category creation, or first-mover language.
- **Blaming the customer** — challenges come from missing infrastructure, not from the customer's failures.
- **Losing the central theme** — human-agent collaboration as peers must run through the whole deck.
- **Content overflow** — the most common problem. When in doubt, cut text.
- **Inventing facts** — the structure file says what slides exist; the content docs say what is true. Do not fill a slide from memory.
