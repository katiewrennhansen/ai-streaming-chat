# Streaming chat

A chat UI that streams replies from OpenAI. It uses React and TypeScript in
the browser, plus a small Express server that calls OpenAI with the official
[`openai`](https://github.com/openai/openai-node) SDK.

The UI is built with [HeroUI v3](https://heroui.com) components (Button,
TextArea, Card, Alert, Spinner) and styled with Tailwind CSS v4. Markdown
replies use Tailwind's typography plugin (`prose`). Light and dark mode follow
the system setting; see the small script in [index.html](index.html).

API state is managed with [TanStack Query](https://tanstack.com/query):
- Each reply request is a `useMutation` in [useChat.ts](src/hooks/useChat.ts).
  Its lifecycle callbacks handle start, complete, stop/fail, and cleanup, and
  `isPending` drives the Send/Stop button. Automatic retries are off, because
  re-sending would stream the reply twice. Users retry with the Retry button.
- The server's setup is a `useQuery` in
  [useServerStatus.ts](src/hooks/useServerStatus.ts), against `GET
  /api/status`. The header shows the model name, or a warning if the key or
  model is missing or the server is down. It refetches when you return to the
  tab.

The messages themselves stay in a reducer. They are on-screen state that
changes on every token, not cached server data.

```bash
nvm use                # Node 22 (see .nvmrc)
npm install
cp .env.example .env   # then fill in OPENAI_API_KEY and OPENAI_MODEL
npm run dev            # web app on http://localhost:5173, API server on :8787
npm test               # stream client, reducer, and markdown-repair tests
```

To run the API server on another port, set `API_PORT`. Vite's proxy follows
it.

## How it fits together

```
browser ──POST /api/chat──▶ server/index.ts ──openai SDK: responses.create({ stream: true })──▶ OpenAI
        ◀── NDJSON events ──                ◀──────────────── streamed events ────────────────
```

| Concern | File |
| --- | --- |
| API server: holds the key, calls OpenAI with the SDK, streams the reply | [server/index.ts](server/index.ts) |
| Wire format shared by server and browser | [src/lib/protocol.ts](src/lib/protocol.ts) |
| Browser stream client (async generator of text chunks) | [src/lib/openAIStream.ts](src/lib/openAIStream.ts) |
| Message state as a discriminated union | [src/lib/types.ts](src/lib/types.ts) |
| State transitions | [src/lib/chatReducer.ts](src/lib/chatReducer.ts) |
| Mid-stream markdown repair | [src/lib/repairMarkdown.ts](src/lib/repairMarkdown.ts) |
| Sending, stop, retry, history, rAF batching, announcements | [src/hooks/useChat.ts](src/hooks/useChat.ts) |
| Auto-scroll that respects the user | [src/hooks/useStickToBottom.ts](src/hooks/useStickToBottom.ts) |
| Memoized message rendering | [src/components/MessageItem.tsx](src/components/MessageItem.tsx) |

## Design notes

### The server and the SDK

- **The key stays on the server.** The browser talks only to `/api/chat`.
  Calling OpenAI straight from React would ship the key to every visitor.
- The server calls `client.responses.create({ model, instructions, input,
  stream: true })` and loops over the events with `for await`. It forwards
  text deltas and turns completion, failure, and incomplete replies into its
  own events.
- **Our own wire format.** The server sends one JSON object per line:
  `delta`, `done`, or `error`. The explicit `done` matters: without it, a
  connection that closes cleanly but early would look like a finished reply.
  The browser treats "closed without `done`" as an error.
- **Stop reaches OpenAI.** Aborting the browser's `fetch` closes the
  connection. The server's `res.on('close')` then aborts the SDK request, so
  we stop paying for tokens nobody will read.
- Requests are validated (roles, length, count) before anything is sent to
  OpenAI. A missing key or model shows up as a clear message in the chat, not
  as a crash.

### Message state: a discriminated union

An assistant message is `pending | streaming | complete | stopped | error`,
and each status is its own variant. Only `error` carries an `error` field, and
`pending` is typed as having empty content. The footer `switch`es on
`status` and ends with `assertNever`, so adding a new status without handling
it is a compile error.

All transitions live in one reducer, and invalid ones are ignored. For
example, a chunk that arrives after Stop doesn't bring the message back to
life.

### Conversation history

Each request sends the conversation so far: user messages plus replies the
user saw (complete, or stopped with text). Failed replies are left out.
Retry resends the history as it was before that reply.

### Markdown mid-stream

Half-finished markdown renders badly. `Some **bol` shows literal asterisks,
and an open code fence renders as prose until it closes. A lone `-` under a
paragraph is a setext heading underline, so the previous line briefly turns
into a big heading.

While a message streams, `repairMarkdown()` patches the text before it is
rendered:
- It closes an open code fence.
- It hides a dangling `-`, `1.`, or `#` on the last line.
- It closes unclosed `**`, `*`, and `` ` `` in the last block, and drops an
  opener that has no text after it yet.

Finished messages render the raw text. Not handled yet: half-finished tables
and links.

### Scroll

- New content is followed only while the user is at the bottom.
- Following stops when the user scrolls up, and content growing can't undo
  that. An upward wheel tick stops following immediately.
- The "at bottom" threshold is small (8px), so a small scroll up doesn't snap
  back down.
- A `ResizeObserver` on the content catches every height change.
- `overflow-anchor: none` stops browser scroll anchoring from fighting the
  follow logic.
- When the user has scrolled up, a "New text below ↓" / "Jump to latest"
  button appears.

### Stop and failure

- **Stop** (or Esc in the input) aborts the request. The message becomes
  `stopped` and keeps its partial text.
- **Failures** keep the partial text and offer Retry. A failure can be an
  OpenAI error, a dropped connection, or the server being unreachable.

### Accessibility and performance

- The transcript is not a live region, because a screen reader would read
  every token. One hidden `role="status"` region announces when a reply
  starts and when it completes (with the full plain-text reply), and also
  stops and errors.
- Chunks are buffered in a ref and committed at most once per animation
  frame.
- The reducer only creates a new object for the message that changed, so
  `React.memo` skips every other message.
- The composer keeps its own input state, so typing doesn't re-render the
  list.

## Next steps

- Persist conversations (localStorage or a database).
- Add a model picker and a system-prompt setting.
- Handle half-finished tables and links in the markdown repair.
- Virtualize the list for very long conversations.
