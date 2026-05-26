# ADR-NNNN — Cowork endpoints migration: parity-first, streaming deferred

**Status:** Draft
**Date:** 2026-05-26
**Builds on:** ADR-0005 (headless platform-API/UI separation)
**Supersedes original Phase 3.1 framing** (see [commit 780c8c74 in `docs/headless-migration.md`](../../headless-migration.md))

## Context

Phase 3 of the headless migration originally bundled three orthogonal problems. Commit `780c8c74` (2026-05-26) split out **Phase 3.1 — Cowork SSE x3**, framed as "all three cowork endpoints stream SSE, design the streaming abstraction." A grilling session on 2026-05-26 found that framing wrong on multiple counts and converged on a much smaller scope.

Phase 3.1 was framed as: `POST /api/cowork/:sid/chat` (LLM streaming), `POST /api/cowork/:sid/message` (user append + optional streaming), `POST /api/cowork/:sid/finalize` (state transition + kick). Grilling produced the corrections below.

## Findings (from grill, 2026-05-26)

### Code vs. spec mismatch

The spec said `/chat` streams. Code says opposite:

| Endpoint | Reality |
|---|---|
| `POST /api/cowork/:sid/chat` | **Non-streaming**. JSON response. Multi-turn MCP tool loop (≤10 iterations), blocking. Returns `{ turnId, agentText, artifact?, toolCalls }`. |
| `POST /api/cowork/:sid/message` | SSE. `text_delta` / `artifact_update` / `done` / `error` events. **Zero callers — dead code since original PR 9f2774c6.** |
| `POST /api/cowork/:sid/finalize` | JSON state transition. **Zero callers.** UI uses Server Action `finalizeSession` which duplicates the same logic with `actorId='ui-user'`. |

### Voice-realtime is not platform-streamed

`createVoiceEphemeralKey` (Server Action) mints an OpenAI Realtime API ephemeral key; browser opens WebRTC directly to OpenAI. No platform involvement during conversation. `synthesizeArtifact` (Server Action) is invoked after transcript completion — blocking JSON-mode LLM call producing structured artifact.

### Server Action surface to delete

`packages/platform-ui/src/app/actions/cowork.ts` exports four functions, all replaceable by JSON endpoints:

| Server Action | Caller | Replacement |
|---|---|---|
| `sendMessage(sessionId, message)` | `chat-cowork-view.tsx` | existing `POST /chat` |
| `finalizeSession(sessionId, artifact)` | `chat-cowork-view.tsx`, `voice-cowork-view.tsx` | existing `POST /finalize` |
| `createVoiceEphemeralKey(sessionId)` | `voice-cowork-view.tsx` | new `POST /voice/ephemeral-key` |
| `synthesizeArtifact(sessionId, transcript, comment?)` | `voice-cowork-view.tsx` | new `POST /voice/synthesize` |

None use Server-Action-specific features (`<form action>`, `revalidatePath`, `redirect`). Per ADR-0005 §6: delete on migrate.

### Streaming abstraction is unnecessary for this phase

No surface that migrates in Phase 3.1 streams. `/message` is dead and gets deleted. `/chat` is JSON. `/finalize` is JSON. Voice helpers are JSON. **No SSE adapter, no handler-shape decision, no event vocabulary needs to land here.**

### Multi-repo atomicity on finalize

Today's `/finalize` does 5 sequential best-effort writes:

1. `coworkSessionRepo.finalize(sessionId, artifact)` (status='finalized')
2. `auditRepo.append(...)` (cowork.session.finalized)
3. `instanceRepo.update(instanceId, { status: 'running', pauseReason: null })`
4. `engine.advanceStep(instanceId, artifact, actor)` (updates currentStepId, persists output)
5. Background fire-and-forget `fetch(/api/processes/:id/run)` → becomes `scope.system.runKicker.kick(instanceId)` after Phase 3 PR1.

No transaction wrapper. Failure between steps leaves the system in inconsistent state (session finalized but instance not resumed, etc.). This gap exists today; the parity migration **preserves it**. Transactional finalize requires Postgres (post-ADR-0001) — defer.

## Decision

**Phase 3.1 = parity migration only. Smallest possible change. No streaming, no schema, no UX improvement.**

Surface after Phase 3.1:

| Endpoint | Method | Shape | Notes |
|---|---|---|---|
| `POST /api/cowork/:sessionId/chat` | POST | JSON | Existing tool-loop, moved to platform-api handler. |
| `POST /api/cowork/:sessionId/finalize` | POST | JSON | Migrated; uses `runKicker.kick`. Multi-repo writes stay best-effort. |
| `POST /api/cowork/:sessionId/voice/ephemeral-key` | POST | JSON | New; replaces `createVoiceEphemeralKey`. |
| `POST /api/cowork/:sessionId/voice/synthesize` | POST | JSON | New; replaces `synthesizeArtifact`. |
| ~~`POST /api/cowork/:sessionId/message`~~ | — | — | **Deleted.** Dead code since 9f2774c6. |
| `app/actions/cowork.ts` | — | — | **Deleted entirely.** All four exports migrated. |

Audit emission stays inside each handler per ADR-0005 §7 (handler-resident bridge via `scope.system.audit`).

`runKicker` arrives via Phase 3 PR1; `finalize` consumes it.

Streaming abstraction (handler shape: AsyncGenerator / callback / EventEmitter), SSE adapter design, event vocabulary, multi-repo transactionality, multi-tab live sync, client-side message queue — **all deferred to follow-up work.**

## Handoff — what we considered

This section preserves the trade-space the grill walked so future readers see why parity won.

### Endpoint shape options considered

1. **Preserve 3-endpoint shape** (`/chat`, `/message`, `/finalize`) — what original Phase 3.1 framing assumed.
2. **Collapse `/chat` + `/message` into `/turn` SSE** with unified event vocabulary (`text_delta`, `tool_call_start`, `tool_call_result`, `artifact_update`, `done`, `error`). Modern LLM-with-tools UX pattern (Claude.ai, Cursor). Migration = right moment to dedupe.
3. **Parity migration** — keep `/chat` JSON tool-loop, delete dead `/message`, keep `/finalize` JSON, add voice helpers as JSON endpoints. No streaming work.

**Chose (3).** Reason: (2) is a UX improvement, not a migration requirement. ADR-0005 separates "move to platform-api" from "redesign streaming." Doing both at once couples scope and risk. Defer (2) to a follow-up issue with concrete UX motivation (streaming UX for tool loops, mid-stream feedback). Drop (1) only for the dead `/message` route — kept for `/chat` and `/finalize`.

### Streaming handler shape options considered (deferred)

- `AsyncGenerator<Event>` returned by handler — cleanest functional style; adapter wraps in `ReadableStream`.
- `write(event)` callback passed to handler — most flexible for pre-existing streaming code.
- `EventEmitter`-style object returned — adapter subscribes.

**Not decided.** No streaming surface migrates in Phase 3.1. When the streaming follow-up lands, the decision picks itself: today's `/message` code is built around raw `fetch` → `ReadableStream` → `getReader()` loop. Wrapping that in an AsyncGenerator is mechanical; the callback form fights it. Vercel AI SDK's `streamText` returns an async iterable that maps trivially to an AsyncGenerator handler.

### Vercel AI SDK considered, rejected for now

- AI SDK 5+ provides `streamText`, `useChat`, structured SSE event format (UIMessage/DataPart).
- Adopting it = locking into AI SDK's vocabulary, which is one more shape to translate to/from when the agent backend is a Claude Code CLI / OpenCode CLI subprocess (both have their own SSE/JSONL event shapes).
- Parity migration doesn't need a new lib. Existing raw-fetch-to-OpenRouter logic works.

**Reconsider when:** streaming follow-up lands AND `useChat` hook on client looks like the right adoption point.

### Compatibility target: Claude Code CLI / OpenCode CLI

Both emit SSE with discriminated-part vocabulary:

| | Claude Code `stream-json` | OpenCode `-f json` |
|---|---|---|
| Text | `content_block_delta` / `text_delta` | `message.part.updated` type=`text` |
| Tools | `content_block_start` tool_use → input deltas → stop | `message.part.updated` type=`tool` state=running/done |
| End | `ResultMessage` | `step_finish` |

Existing `/message` SSE event shape (`text_delta`, `artifact_update`, `done`, `error`) is already in the same family. Extending later to map either CLI's stream into our shape is additive.

### Concurrency model considered (deferred)

- **Server-side queue** (Vercel Chat SDK pattern: `queue` / `debounce` / `concurrent` strategies) — for external-platform bots (Slack/Discord) where client UI is uncontrolled.
- **Client-side queue** (Open WebUI pattern: sessionStorage, combine queued messages into one prompt joined by blank lines) — works for owned UI.
- **No queueing, UI lockout only** — Claude.ai / ChatGPT default.

For cowork the realistic choice is **client-side queue + server `streamingTurnId` guard for multi-tab safety**. Both deferred — current `/chat` is blocking JSON so single-stream-at-a-time semantics already hold.

### Multi-tab live sync considered, rejected

Options: Firestore live subscription (dies post-ADR-0001), server-side event channel (Postgres NOTIFY / Redis pub/sub / in-process EventEmitter), polling, punt.

**Punt.** ChatGPT and Claude.ai don't live-mirror multi-tab same-user; refresh-on-focus is the dominant industry pattern. Live multi-user collab is a separate category and not on cowork's roadmap.

### Reload-during-stream UX considered (deferred)

Options for mid-stream tab reload:

- **Save at end** (today's `/chat` pattern) — reload sees stale state.
- **Save every delta** (Open WebUI `ENABLE_REALTIME_CHAT_SAVE`) — N writes per turn, expensive.
- **Placeholder turn pattern** — write agent turn at stream start with `status: 'streaming'`, update at end. 2 writes per turn. Tool turns already use this pattern (running → success/error in `chat/route.ts` lines 76-110). Extend to text turns when streaming surface lands.

Adds `streamingTurnId: string | null` field on CoworkSession. Recovery: stale flag auto-cleared after timeout.

**Not in Phase 3.1.** Lands with streaming follow-up.

## Consequences

### Positive

- Phase 3.1 ships in days, not weeks. Pure migration, zero new mechanism.
- No streaming abstraction locked in prematurely — future overhaul gets clean slate informed by real UX requirements.
- `app/actions/cowork.ts` fully deleted — Server Action surface in cowork goes to zero.
- `runKicker` consumed by `finalize` — proves the Phase 3 PR1 abstraction at first non-trivial caller.

### Negative

- `/chat` tool-loop UX stays poor (30+ seconds blocking with no feedback). Inherited, not introduced.
- Multi-repo finalize stays best-effort. Inherited.
- Dead `/message` SSE infrastructure (the only existing streaming code) deleted — when streaming follow-up lands it's a clean rebuild from scratch, not an extension. Trade-off: cleaner design vs. losing the working reference implementation. **Acceptable** because the existing impl is raw-fetch glue, not a reusable abstraction.

### Follow-up — single issue covering three deferred items

Tracked in [#516](https://github.com/Appsilon/mediforce/issues/516):

1. **Streaming SSE overhaul** — `/chat` → `/turn` SSE; design handler shape; event vocabulary compatible with Claude Code / OpenCode CLI; placeholder turn pattern; `streamingTurnId` guard; cancellation via AbortSignal.
2. **Client-side message queue UI** — Open WebUI–style sessionStorage queue, combined-prompt or per-turn fire pattern.
3. **Transactional finalize** — post-ADR-0001 Postgres transaction wrapper for multi-repo finalize writes.

Multi-tab live sync intentionally excluded — no demand.

## References

- [ADR-0005 headless platform-API/UI separation](../0005-headless-platform-api-ui-separation.md)
- [headless-migration.md Phase 3.1 section](../../headless-migration.md) (after commit 780c8c74 lands on main)
- [Vercel Chat SDK concurrency changelog](https://vercel.com/changelog/chat-sdk-now-supports-concurrent-message-handling)
- [Open WebUI message queue docs](https://docs.openwebui.com/features/chat-conversations/chat-features/message-queue/)
- [Claude Code SDK streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [OpenCode prompt processing pipeline](https://deepwiki.com/sst/opencode/2.3-prompt-processing-pipeline)
- Original cowork PR introducing dead `/message` route: commit `9f2774c6`
