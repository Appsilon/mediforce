---
name: e2e-record
description: Record E2E journey tests as GIFs for feature documentation and PRs. Use after implementing UI features, when updating the feature gallery, or when the user asks for a feature demo. MUST be used after any UI feature implementation.
allowed-tools: Bash, Read, Write, Glob, Grep
metadata:
  author: Appsilon
  version: "1.1"
  domain: testing
  complexity: basic
  tags: e2e, playwright, recording, gif, testing
---

# Record E2E Journey Tests

## When to Use

- **After implementing any UI feature** — this is mandatory, not optional
- When the user asks to record a demo or generate a GIF
- When updating `docs/features/FEATURES.md` with new feature recordings

## Step 1: Ensure emulators are running

```bash
# Check if emulators are up
curl -s http://127.0.0.1:9099 >/dev/null 2>&1 && echo "Auth emulator: OK" || echo "Auth emulator: NOT RUNNING"
curl -s http://127.0.0.1:8080 >/dev/null 2>&1 && echo "Firestore emulator: OK" || echo "Firestore emulator: NOT RUNNING"
```

If not running, start them:
```bash
cd packages/platform-ui && pnpm emulators &
sleep 10  # wait for Java startup
```

## Step 2: Run tests with recording

Record a specific journey:
```bash
cd packages/platform-ui
NEXT_PUBLIC_USE_EMULATORS=true E2E_RECORD=true npx playwright test --project=authenticated --workers=1 --grep "<test-name-pattern>"
```

Record all journeys:
```bash
cd packages/platform-ui
pnpm test:e2e:record
```

Videos land in `packages/platform-ui/test-results/*/video.webm`.

## Step 3: Convert to GIF

```bash
VIDEO=$(find packages/platform-ui/test-results -name "video.webm" -newer /tmp/e2e-marker | head -1)
ffmpeg -y -i "$VIDEO" -vf "fps=10,scale=960:-1:flags=lanczos" -loop 0 docs/features/<feature-name>.gif
```

For multiple features, loop over the test-results directories.

## Step 4: Update feature gallery

Edit `docs/features/FEATURES.md`:

```markdown
## <Feature Name>

<One-line description.>

![<feature-name>](<feature-name>.gif)
```

## Step 5: Commit

```bash
git add docs/features/<feature-name>.gif docs/features/FEATURES.md
```

## Troubleshooting

- **"connection refused 9099"** — emulators not running. Start with `pnpm emulators`
- **Empty GIF** — test might have failed. Check `pnpm test:e2e:auth` first
- **GIF too large (>5MB)** — reduce fps: `fps=6` instead of `fps=10`
- **ffmpeg not found** — install with `brew install ffmpeg`
