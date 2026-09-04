---
status: living
audience: engineers
last_reviewed: 2026-09-02
---

# Card fonts

The two faces [`generate-og-cards.ts`](../../generate-og-cards.ts) draws with, committed rather than fetched so a card render needs no network and produces the same bytes on every machine. They are build inputs, not site assets — `docs/` is the web root and these deliberately sit outside it, because the pages load their webfonts from Google Fonts as before.

| File | Face | Used for | Licence |
|---|---|---|---|
| `SpaceGrotesk-Bold.ttf` | Space Grotesk 700 | the wordmark and each card's title | [OFL-1.1](SpaceGrotesk-OFL.txt) |
| `Inter-Regular.ttf` | Inter 400 | each card's description and URL | [OFL-1.1](Inter-OFL.txt) |

They match what the pages themselves use: `docs/index.html` sets Space Grotesk for every heading and Inter for body text.

Both are OFL-1.1, which permits redistribution provided the licence travels with the font — hence the two `*-OFL.txt` files beside them. Neither is subsetted: a subset would render a blank glyph the first time a page title used a character it did not cover.
