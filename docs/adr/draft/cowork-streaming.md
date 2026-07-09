# ADR-NNNN — Cowork streaming overhaul (deferred)

**Status:** Draft (deferred — see [#516](https://github.com/Appsilon/mediforce/issues/516))
**Date:** 2026-05-26
**Builds on:** ADR-0005 (headless platform-API/UI separation)
**Successor to:** Phase 3.1 parity migration (landed under ADR-0005, see [`docs/headless-migration.md` § Phase 3.1](../../headless-migration.md))

## Scope of this draft

This draft is **NOT** the record of Phase 3.1's parity migration — that decision lives inside ADR-0005 / `headless-migration.md` because it slotted into the existing headless-migration framework (no new architectural concept).

This draft preserves the trade-space the 2026-05-26 grill session walked through, so the **future streaming overhaul** can start from informed ground instead of re-deriving every option. When the streaming work picks up, this draft becomes a real ADR; until then it's a research note tied to [#516](https://github.com/Appsilon/mediforce/issues/516).

## Background — why the trade-space matters

Phase 3 originally bundled "Cowork SSE x3" alongside the kick-driven mutations. A grill session (2026-05-26) found the SSE framing wrong on multiple counts and split Phase 3.1 out as a **pure parity migration** (no streaming work). That left an unanswered design question — *how should cowork chat actually stream* — sitting in a corner waiting for real UX motivation.

The grill walked through every realistic option for that future work. The notes below are the output. They're not decisions; they're a map of what we already considered so the next round doesn't re-trace it cold.

## Endpoint shape options considered

1. **Keep 3-endpoint shape** (`/chat`, `/message`, `/finalize`) — original Phase 3.1 framing.
2. **Collapse `/chat` + `/message` into `/turn` SSE** with unified event vocabulary (`text_delta`, `tool_call_start`, `tool_call_result`, `artifact_update`, `done`, `error`). Modern LLM-with-tools UX pattern (Claude.ai, Cursor). Migration is the right moment to dedupe.
3. **Parity migration** — keep `/chat` JSON tool-loop, delete dead `/message`, keep `/finalize` JSON, add voice helpers as JSON endpoints. No streaming work.

**Phase 3.1 picked (3).** Reasoning: (2) is a UX improvement, not a migration requirement. ADR-0005 separates "move to platform-api" from "redesign streaming." Doing both at once couples scope and risk.

When the streaming overhaul picks up, (2) is the strongest candidate.

## Streaming handler shape options considered

- `AsyncGenerator<Event>` returned by handler — cleanest functional style; adapter wraps in `ReadableStream`.
- `write(event)` callback passed to handler — most flexible for pre-existing streaming code.
- `EventEmitter`-style object returned — adapter subscribes.

**Not decided.** Today's `/message` code (deleted in Phase 3.1) was built around raw `fetch` → `ReadableStream` → `getReader()` loop. Wrapping that in an AsyncGenerator is mechanical; the callback form fights it. Vercel AI SDK's `streamText` returns an async iterable that maps trivially to an AsyncGenerator handler. AsyncGenerator is the likely pick.

## Vercel AI SDK considered, rejected for now

- AI SDK 5+ provides `streamText`, `useChat`, structured SSE event format (UIMessage/DataPart).
- Adopting it = locking into AI SDK's vocabulary, which is one more shape to translate to/from when the agent backend is a Claude Code CLI / OpenCode CLI subprocess (both have their own SSE/JSONL event shapes).
- Parity migration didn't need a new lib. Existing raw-fetch-to-OpenRouter logic works.

**Reconsider when:** streaming overhaul lands AND `useChat` hook on client looks like the right adoption point.

## Compatibility target: Claude Code CLI / OpenCode CLI

Both emit SSE with discriminated-part vocabulary:

| | Claude Code `stream-json` | OpenCode `-f json` |
|---|---|---|
| Text | `content_block_delta` / `text_delta` | `message.part.updated` type=`text` |
| Tools | `content_block_start` tool_use → input deltas → stop | `message.part.updated` type=`tool` state=running/done |
| End | `ResultMessage` | `step_finish` |

The deleted `/message` SSE event shape (`text_delta`, `artifact_update`, `done`, `error`) was already in the same family. Extending later to map either CLI's stream into our shape is additive.

## Concurrency model considered

- **Server-side queue** (Vercel Chat SDK pattern: `queue` / `debounce` / `concurrent` strategies) — for external-platform bots (Slack/Discord) where client UI is uncontrolled.
- **Client-side queue** (Open WebUI pattern: sessionStorage, combine queued messages into one prompt joined by blank lines) — works for owned UI.
- **No queueing, UI lockout only** — Claude.ai / ChatGPT default.

For cowork the realistic pick is **client-side queue + server `streamingTurnId` guard for multi-tab safety**. Both deferred — Phase 3.1's `/chat` is blocking JSON so single-stream-at-a-time semantics already hold.

## Multi-tab live sync considered, rejected

Options: Firestore live subscription (dies post-ADR-0001), server-side event channel (Postgres NOTIFY / Redis pub/sub / in-process EventEmitter), polling, punt.

**Punt.** ChatGPT and Claude.ai don't live-mirror multi-tab same-user; refresh-on-focus is the dominant industry pattern. Live multi-user collab is a separate category and not on cowork's roadmap.

## Reload-during-stream UX considered

Options for mid-stream tab reload:

- **Save at end** (today's `/chat` pattern) — reload sees stale state.
- **Save every delta** (Open WebUI `ENABLE_REALTIME_CHAT_SAVE`) — N writes per turn, expensive.
- **Placeholder turn pattern** — write agent turn at stream start with `status: 'streaming'`, update at end. 2 writes per turn. Tool turns already use this pattern (running → success/error in the parity-migrated `chat.ts`). Extend to text turns when streaming surface lands.

Adds `streamingTurnId: string | null` field on `CoworkSession`. Recovery: stale flag auto-cleared after timeout.

**Likely pick** when streaming overhaul lands: placeholder turn + `streamingTurnId` guard.

## Multi-repo transactionality (finalize)

Today's `finalize` does 5 sequential best-effort writes:

1. `coworkSessions.finalize(sessionId, artifact)` (status='finalized')
2. `auditRepo.append(...)` (cowork.session.finalized)
3. `runs.update(instanceId, { status: 'running', pauseReason: null })`
4. `engine.advanceStep(instanceId, artifact, actor)` (updates currentStepId, persists output)
5. `runKicker.kick(instanceId)` (fire-and-forget)

No transaction wrapper. Failure between steps leaves the system in inconsistent state. The Phase 3.1 parity migration **preserved** this gap. Transactional finalize requires Postgres (post-ADR-0001) — defer.

**Likely pick** when ADR-0001 lands: Postgres transaction wrapping steps 1-4; step 5 stays fire-and-forget outside the txn (kick is idempotent, doesn't need atomicity with state writes).

## Follow-up — three deferred items tracked in [#516](https://github.com/Appsilon/mediforce/issues/516)

1. **Streaming SSE overhaul** — `/chat` → `/turn` SSE; pick handler shape (AsyncGenerator likely); event vocab compatible with Claude Code / OpenCode CLI; placeholder turn pattern; `streamingTurnId` guard; AbortSignal cancellation.
2. **Client-side message queue UI** — Open WebUI–style sessionStorage queue, combined-prompt or per-turn fire pattern.
3. **Transactional finalize** — post-ADR-0001 Postgres transaction wrapper for multi-repo finalize writes.

Multi-tab live sync intentionally excluded — no demand.

## References

- [ADR-0005 headless platform-API/UI separation](../0005-headless-platform-api-ui-separation.md)
- [`headless-migration.md` § Phase 3.1](../../headless-migration.md) — record of the parity migration that landed
- [Vercel Chat SDK concurrency changelog](https://vercel.com/changelog/chat-sdk-now-supports-concurrent-message-handling)
- [Open WebUI message queue docs](https://docs.openwebui.com/features/chat-conversations/chat-features/message-queue/)
- [Claude Code SDK streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [OpenCode prompt processing pipeline](https://deepwiki.com/sst/opencode/2.3-prompt-processing-pipeline)
- Original cowork PR introducing dead `/message` route: commit `9f2774c6` (deleted in Phase 3.1)
