---
status: draft
audience: engineers
last_reviewed: 2026-08-19
---

# Research — Cowork streaming overhaul (deferred)

**Builds on:** ADR-0005 (headless platform-API/UI separation)

Phase 3 originally bundled "Cowork SSE x3" with the kick-driven mutations. A
grill session (2026-05-26) found the SSE framing wrong on several counts and
split Phase 3.1 out as a **pure parity migration** — no streaming work. That
left the real question, *how should cowork chat stream*, unanswered.

This note preserves the trade-space that session walked, so the future
overhaul starts from informed ground instead of re-deriving every option.
These are **not decisions**; the decision becomes a numbered ADR when the work
picks up. The record of Phase 3.1 itself lives in ADR-0005 /
[`headless-migration.md` § Phase 3.1](../archive/headless-migration.md) — it
needed no new architectural concept.

[#516](https://github.com/Appsilon/mediforce/issues/516) tracks the three
deferred items: streaming SSE overhaul, client-side queue UI, transactional
finalize. Multi-tab live sync is excluded — no demand.

## Endpoint shape

1. **Keep 3-endpoint shape** (`/chat`, `/message`, `/finalize`) — original Phase 3.1 framing.
2. **Collapse `/chat` + `/message` into `/turn` SSE** with a unified event vocabulary (`text_delta`, `tool_call_start`, `tool_call_result`, `artifact_update`, `done`, `error`). The modern LLM-with-tools pattern (Claude.ai, Cursor).
3. **Parity migration** — keep `/chat` JSON tool-loop, delete dead `/message`, keep `/finalize` JSON, add voice helpers as JSON endpoints.

Phase 3.1 picked (3): (2) is a UX improvement, not a migration requirement, and
ADR-0005 separates "move to platform-api" from "redesign streaming." When the
overhaul lands, (2) is the strongest candidate.

## Streaming handler shape

- `AsyncGenerator<Event>` returned by the handler — cleanest functional style; the adapter wraps it in a `ReadableStream`.
- `write(event)` callback passed into the handler — most flexible for pre-existing streaming code.
- `EventEmitter`-style object returned — the adapter subscribes.

Not decided, but AsyncGenerator is the likely pick. The deleted `/message` code
was a raw `fetch` → `ReadableStream` → `getReader()` loop, which wraps
mechanically; the callback form fights it. Vercel AI SDK's `streamText` returns
an async iterable that maps trivially.

## Vercel AI SDK — rejected for now

AI SDK 5+ provides `streamText`, `useChat` and a structured SSE event format
(UIMessage/DataPart). Adopting it means locking into its vocabulary — one more
shape to translate when the agent backend is a Claude Code / OpenCode CLI
subprocess, each with its own event shape. Reconsider when the overhaul lands
*and* `useChat` looks like the right client adoption point.

## Compatibility target: Claude Code / OpenCode CLI

Both emit SSE with a discriminated-part vocabulary:

| | Claude Code `stream-json` | OpenCode `-f json` |
|---|---|---|
| Text | `content_block_delta` / `text_delta` | `message.part.updated` type=`text` |
| Tools | `content_block_start` tool_use → input deltas → stop | `message.part.updated` type=`tool` state=running/done |
| End | `ResultMessage` | `step_finish` |

The deleted `/message` event shape was already in the same family, so mapping
either CLI into ours is additive.

## Concurrency

- **Server-side queue** (Vercel Chat SDK: `queue` / `debounce` / `concurrent`) — for external-platform bots where the client UI is uncontrolled.
- **Client-side queue** (Open WebUI: sessionStorage, queued messages combined into one prompt) — works for owned UI.
- **No queueing, UI lockout only** — the Claude.ai / ChatGPT default.

Realistic pick: client-side queue plus a server `streamingTurnId` guard for
multi-tab safety. Both deferred — today's `/chat` is blocking JSON, so
single-stream-at-a-time semantics already hold.

## Multi-tab live sync — rejected

Options were a Firestore live subscription (dead post-ADR-0001), a server-side
event channel (Postgres NOTIFY / Redis pub-sub / in-process EventEmitter),
polling, or punt. **Punt.** ChatGPT and Claude.ai don't live-mirror multi-tab
same-user; refresh-on-focus is the dominant pattern. Live multi-user collab is
a separate category, not on cowork's roadmap.

## Reload during stream

- **Save at end** (today's `/chat`) — a mid-stream reload sees stale state.
- **Save every delta** (Open WebUI `ENABLE_REALTIME_CHAT_SAVE`) — N writes per turn, expensive.
- **Placeholder turn** — write the agent turn at stream start with `status: 'streaming'`, update at end. Two writes per turn.

Placeholder turn is the likely pick, paired with a `streamingTurnId` guard. Tool
turns in `chat.ts` already work this way (`toolStatus: 'running'` →
`'success'`/`'error'` via `updateTurn`); extending it to text turns is the same
move. Adds a `streamingTurnId: string | null` field on `CoworkSession`, with the
stale flag auto-cleared after a timeout.

## Transactional finalize

`finalizeCoworkSession` does five sequential best-effort writes
([`finalize.ts`](../../packages/platform-api/src/handlers/cowork/finalize.ts)):

1. `coworkSessions.finalize` — status='finalized', persist artifact
2. `system.audit.append` — `cowork.session.finalized`
3. `runs.update` — paused → running, clear `pauseReason`
4. `system.engine.advanceStep` — advance `currentStepId`, persist output
5. `system.runKicker.kick` — fire-and-forget

There is no transaction wrapper, so a failure between steps leaves inconsistent
state. Phase 3.1 preserved that gap.

The original blocker is gone: ADR-0001 landed, Postgres is the datastore, and
drizzle's `db.transaction()` is already used by several repositories including
`cowork-session-repository.ts`. What's missing is a **cross-repo seam** —
`CallerScope` exposes each repository independently with no shared transaction
handle, while steps 2–4 span audit, runs and the engine. Likely shape: wrap
steps 1–4 in one transaction and leave step 5 outside it, since the kick is
idempotent.

## References

- [ADR-0005 headless platform-API/UI separation](../adr/0005-headless-platform-api-ui-separation.md)
- [`headless-migration.md` § Phase 3.1](../archive/headless-migration.md) — the parity migration that landed
- [Vercel Chat SDK concurrency changelog](https://vercel.com/changelog/chat-sdk-now-supports-concurrent-message-handling)
- [Open WebUI message queue docs](https://docs.openwebui.com/features/chat-conversations/chat-features/message-queue/)
- [Claude Code SDK streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [OpenCode prompt processing pipeline](https://deepwiki.com/sst/opencode/2.3-prompt-processing-pipeline)
- Original cowork PR introducing the dead `/message` route: commit `9f2774c6` (deleted in Phase 3.1)
