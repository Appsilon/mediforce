---
title: Theme check
---

# Theme check

This page exists to verify the theme renders every element the ported docs will
use. It is deleted once the real content lands.

## Prose and a card

The body sits on a white card over the dotted canvas ground, the way a step node
sits on the workflow editor canvas. Body text is Inter; headings are Space
Grotesk, both as in the app.

## A table

| Executor | What belongs on it | Control mode |
|---|---|---|
| `human` | Accountability and approval | CM0 |
| `script` | Deterministic parsing, validation, API glue | CM0 |
| `agent` | Agent judgment, with or without an approval gate | CM3 / CM4 |

## Code

```ts
const preset = BLOCK_PRESETS.find((p) => p.id === 'send-email');
```

```bash
pnpm exec mediforce workflow validate ./my-workflow.wd.json
```

## Admonitions

:::note
`status: living` documents are current and safe to act on.
:::

:::warning
A Dry Run is **not** a sandbox — only `agent` and `script` steps are mocked, so
an `email` action still sends the mail.
:::
