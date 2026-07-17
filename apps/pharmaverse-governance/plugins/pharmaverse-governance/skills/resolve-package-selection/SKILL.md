---
name: resolve-package-selection
description: Translate a human user's natural-language description of which pharmaverse packages to evaluate into a concrete filtered list of package objects.
---

# Resolve Package Selection

You are given two things:
1. A full list of discovered pharmaverse packages (from the `discover-packages` step)
2. A single free-text response from a human, describing which subset they want to evaluate in this governance review cycle

Your job is to return a filtered list of packages matching the user's intent.

## Input

Read `/output/input.json`. The relevant fields:

- `steps["discover-packages"].packages` — array of `{ name, repo, repoUrl, defaultBranch, docs, task, details, maintainerName, maintainerEmail }`
- `steps["select-packages"].selection` — the user's free-text response

## Interpretation guidelines

Be **flexible and forgiving**. Accept all of the following kinds of input:

| User input | Expected result |
|---|---|
| `admiral, rhino` | exactly those two |
| `all admiral family` / `admiral*` / `admiral and its variants` | admiral, admiralmetabolic, admiralneuro, admiralonco, admiralophtha, admiralpeds, admiralvaccine |
| `everything` / `all` / `all packages` | full list |
| `all ADaM packages` / `the adam ones` | packages where `task` ~ "ADaM" (case-insensitive match on the `task` field) |
| `all tlg` / `tlg stuff` | `task ~ "tlg"` / `task ~ "TLG"` |
| `the admiral one and rhino please` | admiral + rhino |
| Exact match of `repo` (e.g. `pharmaverse/cards`) | that package |
| A typo like `admeral` | resolve to the closest match (admiral) if clearly intended |

When the user lists items separated by commas, semicolons, slashes, "and", "+", or newlines — treat each as a separate entry.

If input is genuinely ambiguous, **prefer to include more packages rather than fewer**. It is better to collect extra metrics than to silently drop one the user wanted.

If the user's text is empty or can't be parsed at all, fall back to returning the full list (with an explanatory note in `selectionInterpretation`).

## Output

Write `/output/result.json` with this exact shape (matching `discover-packages` for downstream compatibility):

```json
{
  "packages": [
    { "name": "...", "repo": "...", "repoUrl": "...", "defaultBranch": "...", "docs": "...", "task": "...", "details": "...", "maintainerName": null, "maintainerEmail": null }
  ],
  "metadata": {
    "totalDiscovered": 20,
    "totalSelected": 7,
    "userInput": "... the original user selection text ...",
    "selectionInterpretation": "Plain-English explanation of how you parsed the request — e.g. 'Matched `all admiral family` to the 7 packages whose name starts with `admiral`.'",
    "unmatchedTokens": ["any tokens in user input that didn't map to any package"],
    "resolvedAt": "ISO-8601 timestamp"
  }
}
```

- Each entry in `packages` MUST be a full copy of the corresponding discover-packages entry — do not summarize fields.
- The downstream `collect-metrics` step reads `packages[*].name`, `.repo`, `.repoUrl`, `.defaultBranch`; keep those intact.
