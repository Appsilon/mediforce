---
type: gotcha
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [gotcha, e2e, playwright, firebase-emulator, remote]
---

**Remote environments (Claude Code web, CI, fresh machines) need manual E2E prep. Run `python3 packages/platform-ui/scripts/bootstrap_e2e.py` before any E2E test. Idempotent.**

## Symptom

- E2E test fails with "Firebase SDK not initialised", "API key missing", or Playwright "chromium executable not found".
- `test:e2e:auth` hangs on emulator startup in a proxied environment.
- `test:e2e:gif` errors on `ffmpeg: command not found`.

## Cause

Local dev boxes have `.env.local`, Playwright browsers, ffmpeg, and a running Firebase emulator already. Remote agent environments don't. Google Fonts may also fail to download — Next.js falls back to system fonts, tests still work.

## Fix / workaround

Run the bootstrap script. It handles:

| What | Why |
|------|-----|
| `.env.local` with demo creds | Firebase SDK needs API key even in emulator mode. |
| `/tmp/firebase-e2e.json` with `"ui": {"enabled": false}` | Emulator UI download crashes in proxied environments. |
| Start Firebase emulators (Auth 9099, Firestore 8080) | Required by tests. |
| `npx playwright install --with-deps chromium` | Binary must match `@playwright/test` version. |
| `apt-get install ffmpeg` | Needed for GIF conversion. |
| `fuser -k 9007/tcp` | Kill stale dev server. |

```bash
python3 packages/platform-ui/scripts/bootstrap_e2e.py
```

Then:

```bash
cd packages/platform-ui && NEXT_PUBLIC_USE_EMULATORS=true pnpm test:e2e:auth
```

## How to avoid next time

Always run bootstrap before E2E in a new environment. It's idempotent — no harm in running every session. Part of the pre-push checklist in `AGENTS.md`.

## Sources

- `AGENTS.md` → "Remote E2E setup", "Before pushing" checklist
- `packages/platform-ui/scripts/bootstrap_e2e.py`
