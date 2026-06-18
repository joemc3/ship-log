# Optional AI Purser — in-app chat to a self-hosted agent

- **Date:** 2026-06-18
- **Status:** Design approved; ready for implementation plan
- **Author:** Joe + Claude (brainstorming)
- **Supersedes / relates to:** builds on the P2 deploy shape and the P3 two-repo /
  Cowork model in `CLAUDE.md`.

## Summary

Add an **optional**, in-app web chat that lets authenticated owners and crew talk to
a self-hosted AI agent (e.g. a Nous Research **Hermes** agent) from the Ship's Log
web app itself — instead of only via Telegram/CLI. The agent acts as the boat's
"Purser." The app proxies the conversation server-side to the agent's
OpenAI-compatible HTTP endpoint and streams the reply back over SSE.

The feature is **off by default** and is purely additive: with no agent configured,
Ship's Log behaves exactly as it does today. Nothing about any specific boat or
agent (names, persona, hull, port) is hardcoded — the persona lives in the
operator's own agent; this repo stays generic so any fork can enable its own.

## Goals

- Owners **and** crew can chat with the configured agent from a page in the SPA.
- The agent already knows *who it is*; the app tells it *who it is talking to* so it
  addresses each person correctly (solves "it always calls me Joe").
- Reuse the existing trust boundary: the Express server is the single place that
  knows the authenticated identity + role, and it injects that into every agent
  request. The browser never supplies identity.
- Be a model-agnostic, open-source-friendly integration: point it at **any**
  OpenAI-compatible agent; light up extra per-person features when it's a Hermes.
- Be **completely optional** with a clean "don't enable it" path.
- Ship complete documentation (README + CLAUDE.md) as part of the change.

## Non-goals (YAGNI)

- No new action/tool surface. The agent takes actions the way it already does —
  by writing to the **data repo** and committing/pushing; the app's existing
  `SyncScheduler` pulls those changes on its timer. This feature is the
  *conversation* channel only; it does not build a write path through the app API.
- No changes to the agent itself (no Hermes fork, no `gateway/platforms/web.py`).
- No per-role guardrails *inside* the assistant (crew is trusted family/crew). See
  "Cost-redaction exception."
- No multi-agent routing, no voice, no file-upload-to-agent in v1 (Phase 2 candidates).

## Decisions (from brainstorming)

1. **Audience / capability.** One capable assistant for **owner + crew**; **guests
   excluded**. No per-role guardrails inside the assistant — crew is trusted.
2. **Identity / memory.** **Shared communal thread** that all authed users see, with
   **per-person long-term memory**. Each turn is tagged with the speaker, the
   conversation thread is shared, and the agent's long-term memory is scoped per
   user. (Mechanism: Hermes `X-Hermes-Session-Id` = constant; `X-Hermes-Session-Key`
   = username. Degrades gracefully on non-Hermes agents — see below.)
3. **Transport.** **Server-side SSE proxy** (browser → Express → agent) to the
   agent's OpenAI-compatible `/v1/chat/completions` with `stream: true`. Chosen over
   a custom gateway adapter (overkill) and over embedding a standalone web UI
   (decouples identity from the app's roles).
4. **Optionality.** Off by default; `registerAssistantRoutes` is a **no-op** when
   unconfigured. The app is fully functional with no agent.
5. **Generic by default.** No boat/agent-specific strings in the repo. Label and
   persona are the operator's; config is generic (`ASSISTANT_*`).
6. **Cost-redaction exception.** The assistant intentionally bypasses
   `redactDataset` — an owner-authorized, documented exception (details below).

### Confirmed integration contract (Hermes agent)

The target agent's API server creates a **full agent** per request — identical to its
Telegram session — with persona, memory, and tools. Relevant facts confirmed against
a live Hermes agent:

- A `system` message in the OpenAI request body **layers on top** of the agent's core
  system prompt (does not replace it). This is exactly the seam we use to inject the
  speaker tag without clobbering the agent's identity.
- `X-Hermes-Session-Id` resumes/continues a conversation thread.
- `X-Hermes-Session-Key` scopes long-term memory per crew member.

These two headers are **Hermes-specific enhancements**. A non-Hermes OpenAI-compatible
agent simply ignores them: the feature still works, you just lose per-person memory
scoping (everything becomes effectively shared). The app does not depend on them for
correctness.

## Architecture

```
Browser (SPA)                Ship's Log (Docker, behind tunnel)         Host process
┌──────────────┐  same-origin ┌─────────────────────────────────┐  internal ┌──────────┐
│ AssistantPage│──SSE/fetch──▶│ POST /api/assistant/chat         │──HTTP────▶│  agent   │
│  (chat UI)   │◀──tokens─────│  • verify session (user + role)  │◀─stream──│ :PORT    │
└──────────────┘              │  • inject "speaking: Tyler (crew)"│          │ /v1/chat │
                              │  • Session-Id (shared)           │          └──────────┘
                              │  • Session-Key = <username>      │
                              │  • append to shared transcript   │
                              │  • pipe agent stream → SSE       │
                              └─────────────────────────────────┘
                                         │
                                   /app/var (users volume)
                                   shared transcript JSON
                                   (NOT the git data repo)
```

Three new server units (single-responsibility, mirroring `git.ts`/`photos.ts`/`sync.ts`):

- **`src/server/assistant.ts`** — the agent client. A thin wrapper over the agent's
  OpenAI-compatible endpoint: builds the request (model, messages, optional Hermes
  session headers, optional Bearer key), POSTs with `stream: true`, and exposes the
  response as an async token stream. Injected into `createApp` deps so tests pass a
  fake and **no real network is touched** in tests.
- **`src/server/chatlog.ts`** — the shared transcript store. Append/read a **capped**
  JSON array of `{ role, name, content, at }` turns under the users volume
  (`/app/var`). It is the **display** source of truth for the communal thread; the
  agent's own memory is separate. Serial append to avoid corruption. Capped length so
  it never grows unbounded (full long-term context lives in the agent).
- **`src/server/routes/assistant.ts`** — `registerAssistantRoutes(app, ctx)`, wired
  into `createApp` **before** the `/api` 404. A **no-op when the assistant is not
  configured** (route group not registered at all).

### Server routes (all `requireAuth` non-guest + `denyInDemo`)

- **`POST /api/assistant/chat`** — body `{ message }`. The handler:
  1. reads `{ username, role }` from the verified session (already on the request),
  2. builds a generic, server-side **system message**: *"You're speaking with
     `<name>` (`<owner|crew>`) via the ship's web app."* — no boat/agent name. In
     Phase 1 `<name>` is the session username; a real display name is a Phase 2
     enhancement (optional `displayName` on the user record),
  3. appends the user turn (stamped with speaker) to the shared transcript,
  4. calls the agent client with the new turn, `Session-Id` = configured shared id,
     `Session-Key` = username (Hermes headers; ignored by other agents),
  5. **pipes the token stream to the browser as SSE**, and on completion appends the
     assistant turn to the transcript.
- **`GET /api/assistant/history`** — returns the shared transcript (the communal
  thread any authed viewer sees).
- **`DELETE /api/assistant/history`** — **owner-only**; clears the app-side transcript
  ("start fresh" in the UI). Does **not** wipe the agent's own long-term memory.

**Per-turn wire policy:** send the **new** user turn (plus the layered system tag) and
rely on `Session-Id` for the agent's own continuity, rather than replaying the full
transcript every call. The app's transcript store is for **display**; the agent keeps
its own context. (Build-time check: confirm the agent handles a constant `Session-Id`
with a varying `Session-Key` gracefully — it matches the documented contract.)

### `/api/me` surface

Add an `assistant` summary to `GET /api/me` (mirroring the existing `sync` summary):
`assistant: { enabled: boolean, label: string }`. Authenticated/demo only. Lets the
SPA show/hide the nav item and render the configurable label. In demo, `enabled` is
`false`.

## SPA design

- **`src/ui/pages/AssistantPage.tsx`** (route `/assistant`, `RequireAuth` →
  owner+crew; guests never see it; hidden when `!assistant.enabled`). Message list
  rendered from the shared transcript, an input box, and **SSE streaming** render
  (tokens appear live). Reuses the existing `Markdown.tsx` for replies; a lightweight
  "working…" indicator while the stream is open. Co-located
  `AssistantPage.module.css`; shared `app.css` untouched.
- **Nav (`Shell.tsx`):** add the assistant item, labelled from `assistant.label`
  (default "Ask the Purser"), shown only when `assistant.enabled`.
- **`lib/api.ts`:** `assistantHistory()` (GET) + `assistantStream(message, onToken)`
  (POST then read the SSE body via a `fetch` reader — `EventSource` is GET-only).
- **Router (`AppRouter.tsx`):** add the gated `/assistant` route.

## Networking & security

- **Config (generic; follows existing patterns in `config.ts`):**
  - `ASSISTANT_URL` — agent OpenAI-compatible base URL (e.g.
    `http://host.docker.internal:8642`). **Unset ⇒ feature disabled.**
  - `ASSISTANT_API_KEY` (+ `ASSISTANT_API_KEY_FILE` Docker-secret indirection — add to
    `SECRET_FILE_VARS`) — optional Bearer for the proxy hop.
  - `ASSISTANT_MODEL` — model string sent in the request (agent may treat as
    passthrough).
  - `ASSISTANT_LABEL` — UI label, default `"Ask the Purser"`.
  - `ASSISTANT_SESSION_ID` — the shared conversation id, default e.g. `"shiplog"`
    (generic; operators need not change it).
  - **Enabled iff** non-demo **and** `ASSISTANT_URL` set.
- **Container → host networking:** the agent runs as a **host process**, the app runs
  in a container. Add `extra_hosts: ["host.docker.internal:host-gateway"]` to the app
  service in compose and point `ASSISTANT_URL` at `http://host.docker.internal:<port>`.
  No hardcoded host IP.
- **Identity cannot be spoofed:** the system message, `Session-Key`, and `Session-Id`
  are **all derived server-side from the verified session**. The browser never sends
  identity, role, or session headers.
- **Do not expose the agent publicly:** the tunnel fronts only Ship's Log; the agent
  port must be reachable by the container but **not** the public internet (host
  firewall check). Set `ASSISTANT_API_KEY` if the agent supports it.
- **CSP unchanged:** same-origin SSE works under `connect-src 'self'`. No header
  changes; no WebSocket (which would require a CSP change).
- **Failure handling:** agent unreachable/slow → the route emits a graceful SSE error
  event and the UI shows a friendly "couldn't reach the Purser" message; a generic,
  sanitized error only (never the agent URL/key), consistent with the sync layer's
  `lastError` discipline.

## Cost-redaction exception (intentional, documented)

The app's standing invariant is "cost data is owner-only, redacted server-side"
(`redact.ts`, `redaction-golden`). The assistant is a **new surface that
deliberately bypasses `redactDataset`** — an owner-authorized decision, because crew
is trusted and the agent is a conversational partner, not a data API. Two guardrails
keep this honest:

- The `redaction-golden` test walks **dataset JSON** responses. The assistant streams
  **agent text**, not dataset JSON, so the invariant is not violated — **provided we
  never route dataset JSON through this path** (we don't).
- Add a short **CLAUDE.md note** marking the assistant as an intentional, owner-
  authorized exception, and a test asserting crew **can** reach `/api/assistant/*`
  (so a future change does not "fix" this as a bug). The normal app pages remain
  redacted; only the assistant is exempt.

## Documentation deliverables (acceptance criteria)

Per the repo's doc-upkeep rule, the change is **not done** until:

- **README.md** gains an **"Optional: connect an AI Purser"** section covering: what
  it is; that it is **off by default**; prerequisites (a self-hosted OpenAI-compatible
  agent — e.g. a Hermes agent with its API server enabled); the `ASSISTANT_*` config;
  the container→host networking note; the security notes (don't expose the agent port;
  set an API key); the per-crew-memory enhancement for Hermes agents; and **how to run
  with no Purser at all**.
- **CLAUDE.md** gains an assistant-layer section covering: the three server units; the
  route surface + auth posture; the optionality principle (no-op when unconfigured);
  the generic-naming rule (no boat/agent strings in the repo); the identity-injection
  mechanism; and the documented cost-redaction exception + same-change rule (when you
  touch the assistant config surface, update both docs).

## Testing (TDD, the two Vitest projects)

- **Server (`server` project, supertest + an injected fake agent client — no real
  network):**
  - guest → 401 on `/api/assistant/*`; demo → `denyInDemo`.
  - the layered system message + `Session-Key = <username>` + shared `Session-Id` are
    what we send, and cannot be influenced by client-supplied fields.
  - SSE tokens from the fake client stream through to the response.
  - transcript append (user + assistant turns) and shared `GET /history`;
    `DELETE /history` is owner-only (crew → 403).
  - `/api/me` surfaces `assistant.enabled` (+ label); `false` in demo.
  - **no-op when unconfigured:** with `ASSISTANT_URL` unset, `/api/assistant/*`
    returns the standard JSON 404 (route group not registered).
  - `config.test.ts`: `ASSISTANT_API_KEY_FILE` indirection; disabled in demo; enabled
    when `ASSISTANT_URL` set.
- **UI (`ui` project, `AssistantPage.test.tsx`, jsdom + Testing Library):** renders
  history; sends a message; streams a mocked reply; hidden for guest; hidden in demo;
  Markdown renders; nav label reflects `assistant.label`.

## Effort & phasing

Contained and well-bounded: **no data-layer changes, no schema changes, zero changes
to the agent**. Comparable in size to "one existing SPA page (e.g.
`MaintenancePage`) + one server route group + a small store + the sync-style
`/api/me` surface."

Both phases are **production-quality, fully tested, no shortcuts**. The split is about
sequencing complete increments, not about shipping something provisional first —
Phase 1 is a finished, releasable feature on its own; Phase 2 adds further capability.

- **Phase 1 (initial release):** `assistant.ts` client, `routes/assistant.ts` (SSE),
  `chatlog.ts` store, `config.ts` additions, `/api/me` surface, `AssistantPage` + nav
  + router, compose `extra_hosts`, full tests, README + CLAUDE.md updates. → streaming
  chat, communal thread, per-person memory, owner + crew, demo-off, off-by-default.
  Roughly **5 new files + a handful of wiring points**; a focused ~1–2 day TDD build
  for someone fluent in this codebase.
- **Phase 2 (follow-on enhancements):** live tool-progress cards, history-reset UI,
  per-user display names (optional `displayName` on the user record), file/photo to
  the agent, mobile refinements.

## Open questions / verify during build

- Confirm the agent handles a **constant `Session-Id` with a varying `Session-Key`**
  in the same thread (matches the documented contract; verify in practice).
- Confirm the exact **content-type / framing** of the agent's streaming response and
  map it cleanly to our SSE frames.
- Decide the transcript **cap** (number of turns retained for display) and where
  exactly under `/app/var` it lives (a dedicated file alongside `users.json`, never
  inside `DATA_DIR`).
