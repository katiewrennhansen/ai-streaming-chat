import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { chatReducer } from "../lib/chatReducer";
import { openAIStream, StreamFailure } from "../lib/openAIStream";
import type { ChatHistoryItem } from "../lib/protocol";
import { toPlainText } from "../lib/repairMarkdown";
import { AssistantStatuses, type Message, type MessageId } from "../lib/types";

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

// ─── Conversation history ───────────────────────────────────────────────────
/**
 * Turn the on-screen messages into the history we send to OpenAI.
 * The model needs the whole conversation on every request, because it has no
 * memory between calls.
 */
function buildChatHistory(messages: Message[]): ChatHistoryItem[] {
  const history: ChatHistoryItem[] = [];
  for (const m of messages) {
    if (m.role === "user") history.push({ role: "user", content: m.content });
    else if (
      m.status === AssistantStatuses.Complete ||
      (m.status === AssistantStatuses.Stopped && m.content)
    ) {
      history.push({ role: "assistant", content: m.content });
    }
  }
  return history;
}

/**
 * All of the chat's state and actions in one hook.
 *
 * Returns:
 * - `messages`: everything shown in the conversation
 * - `isStreaming`: true while a reply is pending or streaming
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
  // to OpenAI.
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

  /**
   * Stream one reply into the assistant message `id`.
   *
   * send() and retry() both use this. It sets up cancellation, consumes the
   * stream, and moves the message to its final status: complete, stopped,
   * or error.
   */
  const startReply = useCallback(
    async (id: MessageId, history: ChatHistoryItem[]) => {
      // ── Setup ──
      // Normally only one reply streams at a time (the UI blocks sending
      // while streaming). As a safeguard, commit any leftover text and cancel
      // a previous request before starting a new one.
      flush();
      abortRef.current?.abort();

      // A fresh controller for this reply, so stop() knows what to cancel.
      const controller = new AbortController();
      abortRef.current = controller;

      // Point the buffer at this message, starting empty.
      buffer.current = { id, text: "" };
      setAnnouncement("Assistant is responding.");

      // The full reply text, kept for the screen-reader announcement at the
      // end. State updates are batched, so we keep our own copy here.
      let full = "";

      try {
        // ── Streaming ──
        // openAIStream yields text chunks as they arrive from the server.
        // Each chunk goes into the buffer, and a frame is scheduled to commit
        // it if one isn't already pending. `??=` only assigns when
        // frame.current is null, so at most one frame is ever scheduled.
        for await (const chunk of openAIStream(history, controller.signal)) {
          full += chunk;
          buffer.current.text += chunk;
          frame.current ??= requestAnimationFrame(flush);
        }

        // ── Success ──
        // The stream ended with a proper "done" event. Commit the last
        // buffered text, then mark the message complete.
        flush();
        dispatch({ type: "complete", id });
        setAnnouncement(`Assistant replied: ${toPlainText(full)}`);
      } catch (err) {
        // ── Stopped or failed ──
        // Either way, commit what arrived first. The partial reply stays on
        // screen instead of disappearing.
        flush();

        if (controller.signal.aborted) {
          // The user pressed Stop (or the component unmounted). Aborting
          // makes the stream throw, but this isn't an error.
          dispatch({ type: "stop", id });
          setAnnouncement("Response stopped. The partial reply is kept.");
        } else {
          // A real failure. StreamFailure messages are written for users
          // ("The connection dropped mid-reply."), so they are shown as they
          // are. Anything else is a bug, so it is logged and a generic
          // message is shown.
          const message =
            err instanceof StreamFailure ? err.message : "Something went wrong.";
          if (!(err instanceof StreamFailure)) console.error(err);
          dispatch({ type: "fail", id, error: message });
          setAnnouncement(
            "The response failed. Any partial reply is kept, and you can retry.",
          );
        }
      } finally {
        // ── Cleanup ──
        // Clear the "current request" refs, but only if they still belong to
        // this request. If a newer request has already started, these refs
        // are its own, and clearing them would break it.
        if (abortRef.current === controller) {
          abortRef.current = null;
          buffer.current.id = null;
        }
      }
    },
    [flush],
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
      const history = [
        ...buildChatHistory(messagesRef.current),
        { role: "user" as const, content },
      ];
      dispatch({ type: "send", user, assistantId });
      void startReply(assistantId, history); // Fire and forget: it handles its own errors.
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
      void startReply(id, buildChatHistory(all.slice(0, index)));
    },
    [startReply],
  );

  /**
   * Cancel the reply that is streaming. The stream throws, startReply sees
   * the abort, and the message is marked `stopped` with its partial text kept.
   * Does nothing if no reply is streaming.
   */
  const stop = useCallback(() => abortRef.current?.abort(), []);

  // ─── Unmount ────────────────────────────────────────────────────────────
  // If the component goes away mid-reply, cancel the request so the server
  // doesn't keep paying for tokens from OpenAI.
  useEffect(() => () => abortRef.current?.abort(), []);

  // ─── Derived state ──────────────────────────────────────────────────────
  // Read from the messages rather than stored separately, so it can never
  // disagree with what's on screen.
  const isStreaming = messages.some(
    (m) =>
      m.role === "assistant" &&
      (m.status === AssistantStatuses.Pending ||
        m.status === AssistantStatuses.Streaming),
  );

  return {
    messages,
    isStreaming,
    send,
    retry,
    stop,
    announcement,
  };
}
