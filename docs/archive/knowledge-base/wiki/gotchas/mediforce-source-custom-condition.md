---
type: gotcha
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [gotcha, typescript, monorepo, build]
---

**`@mediforce/source` custom TS condition resolves `@mediforce/*` imports to `./src/index.ts` during dev, `./dist/` in prod. Skips the build step entirely in dev.**

## Symptom

- Edit a file in `packages/platform-core/src/` — `platform-ui` picks it up instantly without a rebuild.
- Run Vitest — it uses source TS directly, no compiled output.
- Change `package.json` `exports` or `tsconfig.json` `customConditions` → everything breaks.

## Cause

Every `@mediforce/*` package's `package.json` declares an `exports` map with a `"@mediforce/source"` condition pointing to source `.ts`. Root `tsconfig.json` sets `customConditions: ["@mediforce/source"]`. `vitest.config.ts` sets `resolve.conditions: ["@mediforce/source"]`. In production / published builds the condition is absent → falls back to `./dist/`.

## Fix / workaround

- **Don't** add a manual build step to dev. Source resolution is on purpose.
- **Don't** import from `@mediforce/*/dist/…` paths anywhere.
- New subpath export? Add to all three: `package.json` exports, `tsconfig.json` paths (if present), Vitest conditions should pick up automatically.
- New `@mediforce/*` package? Copy the pattern from `platform-core/package.json` — `exports` block with `@mediforce/source` condition.

## How to avoid next time

Grep before touching: `grep -rn '@mediforce/source' packages/ apps/ tsconfig.json vitest.config.ts`. That's the full surface.

## Sources

- `AGENTS.md` → "How inter-package imports work"
- Root `tsconfig.json` + `vitest.config.ts`
