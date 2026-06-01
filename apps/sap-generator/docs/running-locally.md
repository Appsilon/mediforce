# Running the SAP Generator locally

How to bring up Mediforce on your machine and exercise the `sap-generator`
workflow, given the current state of the repo (branch
`cdisc-workflow-use-case-2`). Command-first; for general dev setup see the
root [`README.md`](../../../README.md) and
[`docs/dev-quickref.md`](../../../docs/dev-quickref.md).

There are **two ways to run**, depending on what you want to see:

- **A. Click through the workflow shell** — fast, no agents actually run. Good for
  demoing the steps, the upload UI, and the review gate. → `pnpm dev:mock`.
- **B. Real end-to-end run** — agents actually read the protocol and generate the
  SAP. Requires Docker + the golden image + an LLM key. → `pnpm dev`.

---

## 0. One-time prerequisites

- Node + `pnpm` (`pnpm install` at the repo root).
- For path B only: **Docker Desktop** running, and an **OpenRouter API key**
  (the workflow routes Claude Code through OpenRouter — see step B3).
- Firebase Auth config in `packages/platform-ui/.env.local` for non-mock modes
  (`pnpm dev`). `pnpm dev:mock` needs none. See the root README "Getting Started".

```bash
pnpm install
```

---

## A. Click-through (mock agents, no keys, no Docker)

```bash
pnpm dev:mock          # port 9007, in-memory backend + Firebase emulators
```

Open <http://localhost:9007>, sign in with the demo credentials
(`test@mediforce.dev` / `test123456`), and register + start the workflow as in
steps B4–B5 below. Agent steps return mocked output rather than a generated SAP —
use this to validate the **workflow shape**, the protocol-upload step, and the
biostatistician review/revise loop, not the generated content.

---

## B. Real end-to-end run (agents generate the SAP)

### B1. Build the agent runtime image

`sap-generator` steps run on `mediforce-golden-image` (the runtime that bundles
the `claude` CLI). Build it once:

```bash
docker build \
  -f packages/agent-runtime/container/Dockerfile.base \
  -t mediforce-golden-image \
  packages/agent-runtime/container
```

(`scripts/rebuild-docker-images.sh` builds this plus the per-app images — but
`sap-generator` only needs the golden image, since it sets no custom
`agent.image`.)

### B2. Boot the platform

```bash
pnpm dev               # docker compose up Postgres + migrate + UI on :9003
```

Leave it running. The UI is at <http://localhost:9003>.

### B3. Provide the LLM key

The workflow's `env` block routes Claude Code through OpenRouter:

```json
"env": {
  "ANTHROPIC_AUTH_TOKEN": "{{OPENROUTER_API_KEY}}",
  "ANTHROPIC_API_KEY": "",
  "ANTHROPIC_BASE_URL": "https://openrouter.ai/api"
}
```

`{{OPENROUTER_API_KEY}}` is resolved from a **workspace/namespace secret**. Set
`OPENROUTER_API_KEY` as a secret on the `appsilon` workspace (UI → workspace
settings → secrets). Resolution precedence: the workflow's own `env` →
workspace/namespace secret → the server's `DOCKER_OPENROUTER_API_KEY`. Prefer the
workspace secret so billing stays with the workspace.

> OpenRouter base URL is `…/api` (not `…/api/v1`) for Claude Code.

### B4. Register the workflow (CLI > REST)

```bash
export MEDIFORCE_API_KEY="<PLATFORM_API_KEY from packages/platform-ui/.env.local>"
export MEDIFORCE_BASE_URL="http://127.0.0.1:9003"   # 127.0.0.1, not localhost

pnpm exec mediforce workflow register \
  --file apps/sap-generator/src/sap-generator.wd.json \
  --namespace appsilon

pnpm exec mediforce workflow list                   # confirm it registered
```

Add `--dry-run` first to validate without persisting. **Never target
production.**

### B5. Start a run and upload a protocol

Easiest via the UI: open <http://localhost:9003>, find **"Protocol to SAP
generator"**, start a run, and on the first step upload a protocol PDF. Real test
protocols already live in the repo:

```
apps/protocol-to-tfl/data/test-docs/nsclc-phase3/NCT04325698_Prot_000.pdf
apps/protocol-to-tfl/data/test-docs/cdiscpilot01/cdiscpilot01-protocol.pdf
```

(Or start a run from the CLI: `pnpm exec mediforce run start --workflow
sap-generator --namespace appsilon`, then attach the file via the UI step.)

### B6. Watch it run and review

The three agent steps run in sequence (extract → draft → traceability), each in a
golden-image container. Then the run pauses at **Review SAP** for a human verdict:

- **Approve** → advances to `finalize` → `Done`.
- **Revise** (with feedback) → loops back to `draft-sap` for another pass.

Generated artifacts (`study-design.json`, `sap-draft.md`,
`traceability-matrix.json`, `analysis-metadata.json`, `sap-final.md`) are written
to the run's workspace (see caveat below).

```bash
pnpm exec mediforce run get <runId>     # status from the terminal
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent step fails immediately, "image not found" | Build the golden image (B1). The workflow sets no custom `agent.image`, so it relies on `mediforce-golden-image` existing locally. |
| Agent runs but auth fails / 401 from the model | `OPENROUTER_API_KEY` workspace secret missing or capped. Note: OpenRouter "Key limit exceeded" is a per-key cap, separate from account credits. |
| Workspace clone fails on first agent step | The workflow declares `"workspace": { "remote": "Appsilon/mediforce-clinical-workspace" }` (a private repo). If you lack access, edit `sap-generator.wd.json` and remove the `workspace` block for local testing — outputs then live in the run's local worktree. Don't commit that change. |
| `DATABASE_URL is required` at boot | You're in a non-mock mode without a DB — use `pnpm dev` (it boots Postgres), or use `pnpm dev:mock`. |
| Port 9003 busy | `lsof -ti:9003 \| xargs kill -9`, or `PORT=9999 pnpm dev`. |
| CLI "fetch failed" | Use `127.0.0.1` not `localhost` in `MEDIFORCE_BASE_URL` (Node prefers IPv6; the dev server binds IPv4). |

> **`ALLOW_LOCAL_AGENTS=true` is a dead end** — it forces in-process execution
> where the `claude` CLI isn't available. Use the Docker path above (or
> `pnpm dev:no-docker`, which runs agents via your host `claude` CLI — in that
> mode the OpenRouter `env` block still applies, so either set the workspace
> secret or remove the `env` block to use your local Claude auth).

## Validate without running

The workflow definition is schema- and structure-checked by the app's test —
fast feedback without booting anything:

```bash
pnpm --filter @mediforce/sap-generator test
```
