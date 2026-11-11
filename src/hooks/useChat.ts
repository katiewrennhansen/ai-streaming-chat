import { useCallback, useState } from "react";
import type { Message } from "../lib/types";

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/**
 * The chat's state and actions. This is a scaffold: sending only adds the
 * user's message for now.
 *
 * Available helpers:
 * - `openAIStream(history, signal)` in ../lib/openAIStream.ts: an async
 *   generator of text chunks from the server. It throws `StreamFailure` on
 *   errors, and rethrows the AbortError when `signal` is aborted.
 * - `ChatHistoryItem` in ../lib/protocol.ts: the history shape the server
 *   expects.
 */
export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);

  const send = useCallback(
    (content: string) => {
      const user: Message = { id: newId("user"), role: "user", content };
      setMessages((prev) => [...prev, user]);

      console.log("Sent message:", messages);

      // TODO: add an assistant message and stream the reply into it.
    },
    [messages],
  );

  // TODO: cancel the reply that is streaming.
  const stop = useCallback(() => {}, []);

  // TODO: derive this from your state.
  const isStreaming = false;

  return { messages, isStreaming, send, stop };
}
