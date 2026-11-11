import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { chatReducer } from "../lib/chatReducer";
import { openAIStream, StreamFailure } from "../lib/openAIStream";
import type { ChatTurn } from "../lib/protocol";
import { toPlainText } from "../lib/repairMarkdown";
import type { Message, MessageId } from "../lib/types";

// ─── IDs ────────────────────────────────────────────────────────────────────
// Each message needs a unique id, which React also uses as its list `key`. A
// simple counter is enough, because ids only need to be unique within this
// browser tab.
let nextId = 0;
const newId = (prefix: string) => `${prefix}-${++nextId}`;

// ─── Conversation history ───────────────────────────────────────────────────
/**
 * Turn the on-screen messages into the history we send to OpenAI.
 *
 * The model needs the whole conversation on every request, because it has no
 * memory between calls. We include:
 * - every user message
 * - assistant replies the user actually saw: complete ones, and stopped ones
 *   that have some text
 *
 * Failed replies, and replies still pending or streaming, are left out, so the
 * model never sees a broken or half-written answer as part of the history.
 */
function toTurns(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (m.role === "user") turns.push({ role: "user", content: m.content });
    else if (m.status === "complete" || (m.status === "stopped" && m.content)) {
      turns.push({ role: "assistant", content: m.content });
    }
  }
  return turns;
}

/** Everything one reply request needs. These are the mutation's "variables". */
interface ReplyRequest {
  /** The assistant message the reply streams into. */
  id: MessageId;
  /** The conversation history to send. */
  turns: ChatTurn[];
  /** Cancels this request. Created per request, so Stop cancels the right one. */
  controller: AbortController;
}

/**
 * All of the chat's state and actions in one hook.
 *
 * Who owns what:
 * - TanStack Query (`useMutation`) owns each reply *request*: running it,
 *   tracking whether one is in flight, and calling our lifecycle callbacks.
 * - The reducer owns the *messages* on screen: their text, and the status of
 *   each one (pending → streaming → complete / stopped / error).
 *
 * Returns:
 * - `messages`: everything shown in the conversation
 * - `isStreaming`: true while a reply request is in flight
 * - `send(text)`: send a new user message and stream the reply
 * - `retry(id)`: regenerate a reply that failed or was stopped
 * - `stop()`: cancel the reply that is streaming
 * - `announcement`: text for the screen-reader live region
 */
export function useChat() {
  // ─── State ──────────────────────────────────────────────────────────────
  // `messages` lives in a reducer (see chatReducer.ts), which owns every
  // allowed status change. This hook only dispatches actions and never edits
  // messages directly.
  const [messages, dispatch] = useReducer(chatReducer, []);

  // What the screen-reader live region should say. It's updated at the start
  // and end of a reply, not on every token (see App.tsx).
  const [announcement, setAnnouncement] = useState("");

  // ─── Latest messages, without re-creating callbacks ─────────────────────
  // send() and retry() need the current messages to build the history. If
  // they used `messages` directly, they would be re-created on every streamed
  // chunk. Their props would then change, and the composer would re-render as
  // the reply types out. Reading from a ref keeps them stable.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ─── Cancellation ───────────────────────────────────────────────────────
  // The AbortController of the request in flight, if any. Calling abort()
  // cancels the fetch to our server, and the server then cancels its request
  // to OpenAI. TanStack mutations have no built-in cancel, so we keep our own.
  const abortRef = useRef<AbortController | null>(null);

  // ─── Chunk batching ─────────────────────────────────────────────────────
  // Updating state for every chunk could mean several renders per screen
  // frame, since OpenAI often sends tokens in bursts. Instead, chunks are
  // added to `buffer` (a ref, so adding to it causes no render), and at most
  // one animation frame is scheduled to commit everything buffered so far.
  //
  // `buffer.id` is the assistant message the text belongs to.
  // `frame` is the scheduled requestAnimationFrame id, or null if none is
  // pending.
  const buffer = useRef<{ id: MessageId | null; text: string }>({
    id: null,
    text: "",
  });
  const frame = useRef<number | null>(null);

  /**
   * Commit buffered text to state right now.
   *
   * It runs in two ways:
   * - From requestAnimationFrame, which is the normal batching path.
   * - Directly, before a reply finishes, fails, or is stopped, so the last
   *   few chunks are never lost.
   *
   * Any scheduled frame is cancelled first, so the same text can't be
   * committed twice.
   */
  const flush = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const { id, text } = buffer.current;
    if (!id || !text) return; // Nothing to commit.
    buffer.current.text = "";
    dispatch({ type: "append", id, text });
  }, []);

  // ─── The reply request, as a TanStack mutation ──────────────────────────
  // A mutation fits a chat message: it's a POST that runs when the user acts,
  // rather than data we fetch and cache. TanStack calls the callbacks below
  // in order: onMutate → mutationFn → onSuccess or onError → onSettled.
  //
  // The callbacks live here on useMutation (not on each mutate() call) so
  // they run for *every* request, including one that was replaced by a newer
  // request before it finished.
  const reply = useMutation({
    mutationKey: ["chat-reply"],
    // Never retry automatically. Re-sending would stream the whole reply
    // again on top of the partial one. Users retry with the Retry button.
    retry: false,

    // ── Before the request: point the buffer at this message ──
    onMutate: ({ id }: ReplyRequest) => {
      buffer.current = { id, text: "" };
      setAnnouncement("Assistant is responding.");
    },

    // ── The request: stream the reply ──
    // openAIStream yields text chunks as they arrive from the server. Each
    // chunk goes into the buffer, and a frame is scheduled to commit it if
    // one isn't already pending. `??=` only assigns when frame.current is
    // null, so at most one frame is ever scheduled. The full text is
    // returned, and TanStack passes it to onSuccess.
    mutationFn: async ({ turns, controller }: ReplyRequest) => {
      let full = "";
      for await (const chunk of openAIStream(turns, controller.signal)) {
        full += chunk;
        buffer.current.text += chunk;
        frame.current ??= requestAnimationFrame(flush);
      }
      return full;
    },

    // ── Success: the stream ended with a proper "done" event ──
    // Commit the last buffered text, then mark the message complete.
    onSuccess: (full, { id }) => {
      flush();
      dispatch({ type: "complete", id });
      setAnnouncement(`Assistant replied: ${toPlainText(full)}`);
    },

    // ── Stopped or failed ──
    // Either way, commit what arrived first. The partial reply stays on
    // screen instead of disappearing.
    onError: (err, { id, controller }) => {
      flush();

      if (controller.signal.aborted) {
        // The user pressed Stop (or the component unmounted). Aborting makes
        // the stream throw, but this isn't an error.
        dispatch({ type: "stop", id });
        setAnnouncement("Response stopped. The partial reply is kept.");
        return;
      }

      // A real failure. StreamFailure messages are written for users ("The
      // connection dropped mid-reply."), so they are shown as they are.
      // Anything else is a bug, so it is logged and a generic message is
      // shown.
      const message =
        err instanceof StreamFailure ? err.message : "Something went wrong.";
      if (!(err instanceof StreamFailure)) console.error(err);
      dispatch({ type: "fail", id, error: message });
      setAnnouncement(
        "The response failed. Any partial reply is kept, and you can retry.",
      );
    },

    // ── Cleanup, after success or error ──
    // Clear the "current request" refs, but only if they still belong to
    // this request. If a newer request has already started, these refs are
    // its own, and clearing them would break it.
    onSettled: (_data, _err, { controller }) => {
      if (abortRef.current === controller) {
        abortRef.current = null;
        buffer.current.id = null;
      }
    },
  });

  // `mutate` keeps the same identity for the hook's lifetime, so send/retry
  // (and the composer's props) stay stable while a reply streams.
  const { mutate } = reply;

  /**
   * Start a reply request for assistant message `id`.
   *
   * Normally only one reply streams at a time (the UI blocks sending while
   * streaming). As a safeguard, any buffered text is committed and a previous
   * request is cancelled before the new one starts.
   */
  const startReply = useCallback(
    (id: MessageId, turns: ChatTurn[]) => {
      flush();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      mutate({ id, turns, controller });
    },
    [flush, mutate],
  );

  // ─── Public actions ─────────────────────────────────────────────────────

  /**
   * Send a new user message and stream the reply.
   *
   * Two messages are added in one action: the user's message, and an empty
   * assistant message in `pending` status, which shows the spinner. The
   * history is built from the messages *before* this send, plus the new
   * user text.
   */
  const send = useCallback(
    (content: string) => {
      const user = { id: newId("user"), role: "user" as const, content };
      const assistantId = newId("assistant");
      const turns = [
        ...toTurns(messagesRef.current),
        { role: "user" as const, content },
      ];
      dispatch({ type: "send", user, assistantId });
      startReply(assistantId, turns);
    },
    [startReply],
  );

  /**
   * Regenerate a failed or stopped reply, keeping it in the same place in the
   * conversation.
   *
   * The history is everything *before* that reply, so the model answers the
   * same question again. Later messages are not included. The reducer resets
   * the message to `pending`, which clears the old partial text.
   */
  const retry = useCallback(
    (id: MessageId) => {
      const all = messagesRef.current;
      const index = all.findIndex((m) => m.id === id);
      if (index === -1) return; // Unknown id: nothing to retry.
      dispatch({ type: "retry", id });
      startReply(id, toTurns(all.slice(0, index)));
    },
    [startReply],
  );

  /**
   * Cancel the reply that is streaming. The stream throws, onError sees the
   * abort, and the message is marked `stopped` with its partial text kept.
   * Does nothing if no reply is streaming.
   */
  const stop = useCallback(() => abortRef.current?.abort(), []);

  // ─── Unmount ────────────────────────────────────────────────────────────
  // If the component goes away mid-reply, cancel the request so the server
  // doesn't keep paying for tokens from OpenAI.
  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    messages,
    isStreaming: reply.isPending,
    send,
    retry,
    stop,
    announcement,
  };
}
