# Getting Started

Get the app running locally in minutes. Start with Firebase emulators and demo data, then progress to building your own workflows.

## Prerequisites

- Node.js 20+
- pnpm 10+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- Firebase CLI (`npm install -g firebase-tools`)

---

## 1. Fastest start — click through the app (no setup)

```bash
pnpm install
pnpm dev:mock
```

Open http://localhost:9007. No Firebase, no keys, no Docker. Agents are mocked,
workflow data lives in `MEDIFORCE_DATA_DIR` (in-memory file-based fake).
Use this to explore the UI before configuring anything real.

---

## 2. Emulator + seeded demo data

Run the app with pre-seeded demo workflows against Firebase emulators.

### Step 1: Install + env

```bash
pnpm install
cp packages/platform-ui/.env.example packages/platform-ui/.env.local
```

The example file's defaults already target the emulator (project id `demo-mediforce`).

### Step 2: Start emulators (separate terminal)

```bash
pnpm emulators
```

This starts Firebase Auth (:9099), Firestore (:8080), and Storage (:9199),
persisting state to `packages/platform-ui/.emulator-data/`.

### Step 3: Seed demo data

```bash
pnpm seed
```

Seeds:
- Workflow definitions (Supply Chain Review, Protocol to TFL, Workflow Designer)
- Process instances in various states (running, paused, completed)
- Human tasks ready for action
- Agent runs with results

### Step 4: Start the app

```bash
NEXT_PUBLIC_USE_EMULATORS=true pnpm dev
```

Open http://localhost:9003

### Step 5: Sign in

Demo credentials:
- **Email**: test@mediforce.dev
- **Password**: test123456

**You'll see:**
- Workflow Dashboard with demo workflows
- Process instances in various states
- Tasks assigned to the test user

**Emulator ports:**
- App: http://localhost:9003
- Firebase Auth: http://localhost:9099
- Firestore: http://localhost:8080

**Limitations:**
- Data disappears when emulators stop
- For persistent data, see [Step 5](#5-persistent-data-with-your-firebase)

---

## 2. Add Your First Workflow

Workflows are defined in JSON. You can create them via API or UI.

### Via API

```bash
curl -X POST "http://localhost:9003/api/workflow-definitions?namespace=my-namespace" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: test-api-key" \
  -d '{
    "name": "my-first-workflow",
    "description": "A simple workflow to get started",
    "preamble": "This workflow demonstrates the basic structure.",
    "triggers": [
      { "name": "manual", "type": "manual" }
    ],
    "steps": [
      {
        "id": "do-work",
        "name": "Do the Work",
        "type": "creation",
        "executor": "human",
        "allowedRoles": ["operator"]
      },
      {
        "id": "review",
        "name": "Review",
        "type": "review",
        "executor": "human",
        "allowedRoles": ["reviewer"],
        "verdicts": {
          "approve": { "target": "done" },
          "revise": { "target": "do-work" }
        }
      },
      {
        "id": "done",
        "name": "Done",
        "type": "terminal",
        "executor": "human"
      }
    ],
    "transitions": [
      { "from": "do-work", "to": "review" }
    ]
  }'
```

The API returns:
```json
{ "success": true, "name": "my-first-workflow", "version": 1 }
```

**Key concepts:**
- `namespace` — groups your workflows (used in query param)
- `name` — unique workflow identifier within namespace
- `triggers` — how workflows start (manual, cron, etc.)
- `steps` — human tasks, agent tasks, or both
- `transitions` — rules for moving between steps
- `verdicts` — for review steps, define where each outcome goes

**Step types:**
- `creation` — creates or modifies data
- `review` — requires human verdict (approve/revise)
- `decision` — conditional branching logic
- `terminal` — end of workflow

**Executor types:**
- `human` — task assigned to human role
- `agent` — AI agent executes
- `script` — containerized script (Docker)
- `cowork` — interactive coworker session

### Via UI

1. Go to http://localhost:9003/catalog
2. Click "Create Workflow"
3. Use the visual editor to add steps and transitions
4. Save

---

## 3. Run Your First Workflow

Start a process instance from a workflow definition.

### Via API

```bash
curl -X POST http://localhost:9003/api/processes \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: test-api-key" \
  -d '{
    "definitionName": "my-first-workflow",
    "triggeredBy": "test-user"
  }'
```

The API returns:
```json
{ "instanceId": "proc-abc123", "status": "running" }
```

### Via UI

1. Go to http://localhost:9003/workflows
2. Click on your workflow
3. Click "Run"
4. Configure variables if needed
5. Start the run

**What happens:**
- New process instance created
- Workflow execution begins at first step
- Tasks appear in Tasks view as execution progresses

---

## 4. Build Your Own Workflow

Workflows combine human tasks and AI agent tasks with configurable autonomy levels.

### Autonomy Levels

| Level | Agent Role | Human Involvement |
|-------|-----------|-------------------|
| L0 | None | Full human control |
| L1 | Suggests | Human decides |
| L2 | Drafts | Human approves |
| L3 | Acts, reviews | Periodic human review |
| L4 | Autonomous | Exception handling only |

### Example: Document Review with AI Assistance

```json
{
  "name": "document-review",
  "description": "Upload documents, AI analyzes, human reviews",
  "preamble": "Review uploaded documents with AI assistance.",
  "triggers": [
    { "name": "manual", "type": "manual" }
  ],
  "steps": [
    {
      "id": "upload",
      "name": "Upload Documents",
      "type": "creation",
      "executor": "human",
      "ui": {
        "component": "file-upload",
        "config": {
          "acceptedTypes": ["application/pdf"],
          "maxFiles": 5
        }
      }
    },
    {
      "id": "analyze",
      "name": "AI Analysis",
      "type": "creation",
      "executor": "agent",
      "autonomyLevel": "L2",
      "plugin": "opencode-agent",
      "agent": {
        "skill": "analyze-documents",
        "skillsDir": "apps/document-review/skills",
        "model": "sonnet"
      }
    },
    {
      "id": "review",
      "name": "Review Results",
      "type": "review",
      "executor": "human",
      "allowedRoles": ["reviewer"],
      "verdicts": {
        "approve": { "target": "done" },
        "revise": { "target": "analyze" }
      }
    },
    {
      "id": "done",
      "name": "Done",
      "type": "terminal",
      "executor": "human"
    }
  ],
  "transitions": [
    { "from": "upload", "to": "analyze" },
    { "from": "analyze", "to": "review" }
  ]
}
```

**Note:** The `skillsDir` path (`apps/document-review/skills`) is illustrative. Create this directory structure if you're building a custom agent plugin, or reference an existing plugin like `apps/community-digest/plugins/community-digest/skills`.

**See real examples:**
- `apps/community-digest/src/community-digest.wd.json` — Daily GitHub digest
- `apps/protocol-to-tfl/src/protocol-to-tfl.wd.json` — Clinical protocol to TFL

---

## 5. Persistent Data with Your Firebase

When you need data that persists between sessions, use your own Firebase project.

### Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. "Add project" → name it (e.g., "mediforce-dev")
3. Enable **Firestore Database** (production mode, choose region)
4. Enable **Authentication** → Email/Password provider

### Get Credentials

Firebase Console → Project Settings (gear) → General → Your apps → Web app (`</>`)

Copy the config object values.

### Configure `.env.local`

Edit `packages/platform-ui/.env.local`:

```bash
# Firebase (required)
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com  # optional
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id       # optional
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id                       # optional

# API key for server-to-server calls (required)
# This key gates all API write operations — keep it secret
PLATFORM_API_KEY=your-secret-key

# Optional: LLM keys for agent execution
OPENROUTER_API_KEY=your-openrouter-key
```

Required: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `PLATFORM_API_KEY`.

### Service-account credentials (Firebase Admin SDK)

When NOT using emulators, the server needs a Firebase service-account JSON to talk to Firestore with admin privileges.

1. Firebase Console → Project Settings → Service Accounts → **Generate new private key**
2. Save the downloaded JSON outside the repo (e.g. `~/.config/mediforce/firebase-sa.json`)
3. Add to `.env.local`:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/Users/<you>/.config/mediforce/firebase-sa.json
```

Use an absolute path — the server validates the file exists on startup.

### Run with Production Firebase

```bash
pnpm dev
```

**Important:** The UI starts empty. Your workflows and data are private to your Firebase project. Create workflows via UI or API to populate.

### Firestore Security Rules (Development)

Firebase Console → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

⚠️ **Never use permissive rules in production.**

---

## 6. Troubleshooting

### Port already in use

```bash
lsof -ti:9003 | xargs kill -9
```

### Emulators fail to start

```bash
pnpm emulators
```

If the port is occupied, the script prompts to kill blocking processes. If Java is missing, install with `brew install openjdk@21` (macOS) or `apt-get install openjdk-21-jre` (Linux).

### "Permission denied" Firestore errors

Ensure security rules allow read/write (see Step 5).

### Workflow POST returns 400

Common issues:
- Missing `namespace` query param
- Invalid step `type` (must be: `creation`, `review`, `decision`, `terminal`)
- Missing required fields (`name`, `triggers`, `steps`, `transitions`)

### No workflows appear after POST

Check the namespace matches. List all workflows:

```bash
curl -H "X-Api-Key: test-api-key" \
  http://localhost:9003/api/workflow-definitions
```

### Process instance doesn't start

Ensure the workflow definition exists:

```bash
curl -H "X-Api-Key: test-api-key" \
  "http://localhost:9003/api/workflow-definitions?namespace=my-namespace"
```

### Demo data doesn't appear after seed

Make sure:
1. Emulators are running (`pnpm emulators`)
2. You ran `pnpm seed`
3. You're using `NEXT_PUBLIC_USE_EMULATORS=true` when starting the app

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm dev:mock` | Mocked agents + in-memory data, port 9007 — no setup |
| `pnpm emulators` | Start Firebase emulators (Auth + Firestore + Storage) |
| `pnpm seed` | Seed demo data into running emulators |
| `NEXT_PUBLIC_USE_EMULATORS=true pnpm dev` | Run with emulators (port 9003) |
| `pnpm dev` | Run with production Firebase (per `.env.local`) |
| `pnpm dev:no-docker` | Like `dev`, agents via host `claude` CLI |
| `pnpm dev:queue` | Like `dev`, production-like queue mode (run `docker compose up -d` first) |
| `pnpm test:unit` | vitest unit + integration |
| `pnpm test:affected` | vitest, only files changed |
| `pnpm test:e2e` | All Playwright E2E (L3 + L4) |
| `pnpm test` | Everything (unit + e2e) |

---

## Next Steps

- [Architecture](docs/architecture.md) — processes, steps, agents, compliance
- [Development Guide](docs/development.md) — monorepo structure, testing, deployment
- [AGENTS.md](AGENTS.md) — contribution guidelines for AI-assisted development
- [Features](docs/features/FEATURES.md) — feature gallery with recorded walkthroughs