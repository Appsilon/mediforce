---
name: e2e-record
description: Record E2E journey tests as GIFs for feature documentation and PRs. Use when the user asks to record a feature demo, generate a GIF for a PR, or update the feature gallery.
allowed-tools: Bash, Read, Write, Glob, Grep
metadata:
  author: Appsilon
  version: "1.0"
  domain: testing
  complexity: basic
  tags: e2e, playwright, recording, gif, testing
---

# Record E2E Journey Tests

## When to Use

- After implementing a feature and its journey test passes
- When the user asks to record a demo or generate a GIF
- When updating `docs/features/FEATURES.md` with new feature recordings

## Prerequisites

- Firebase Emulators running: `pnpm emulators` (in separate terminal or tmux)
- ffmpeg installed: `brew install ffmpeg` (for GIF conversion)

## Recording a Journey Test

### Step 1: Run with video recording

```bash
cd packages/platform-ui
E2E_RECORD=true npx playwright test --project=authenticated --grep "<test-name-pattern>"
```

This runs the matching journey test with Playwright video recording enabled (`slowMo: 300ms` for readable output).

Videos land in `test-results/` as `.webm` files.

### Step 2: Convert to GIF

```bash
# Find the recorded video
VIDEO=$(find test-results -name "*.webm" -newer /tmp/e2e-record-marker | head -1)

# Convert to GIF (960px wide, 10fps, looping)
ffmpeg -i "$VIDEO" -vf "fps=10,scale=960:-1:flags=lanczos" -loop 0 output.gif
```

### Step 3: Add to feature gallery

```bash
# Copy GIF to docs
cp output.gif docs/features/<feature-name>.gif
```

Then update `docs/features/FEATURES.md`:

```markdown
## <Feature Name>

<Short description of what the feature does.>

![<feature-name>](<feature-name>.gif)
```

### Step 4: Commit with PR

```bash
git add docs/features/<feature-name>.gif docs/features/FEATURES.md
```

## All-in-one command

Record all journey tests and generate GIFs:

```bash
cd packages/platform-ui && pnpm test:e2e:gif
```

Record a specific test:

```bash
cd packages/platform-ui && pnpm test:e2e:gif -- --grep "reviewer approves"
```

## Notes

- GIFs are typically 2-5MB each. Keep under 10MB.
- If a feature changes significantly, re-record and replace the old GIF.
- The `FEATURES.md` gallery serves as living documentation of what the app does.
