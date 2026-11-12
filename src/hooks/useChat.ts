import { useCallback, useRef, useState, useEffect } from "react";
import type { Message, MessageId } from "../lib/types";
import type { ChatHistoryItem } from "../lib/protocol";
import { openAIStream } from "../lib/openAIStream";

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
  const abortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  /**
   * Stream a reply into the assistant message `assistantId`, which must
   * already be in state. Shared by send() and retry().
   */
  const streamReply = useCallback(
    async (assistantId: MessageId, history: ChatHistoryItem[]) => {
      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const setStatus = (status: Message["status"]) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, status } : m)),
        );

      try {
        for await (const chunk of openAIStream(history, controller.signal)) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m,
            ),
          );
        }
        setStatus("complete");
      } catch (err) {
        if (controller.signal.aborted) {
          // The user stopped it. Not an error: keep the partial text.
          setStatus("stopped");
        } else {
          console.error("Error streaming AI response:", err);
          setStatus("error");
        }
      } finally {
        // Clear the ref, but only if it still belongs to this request.
        if (abortRef.current === controller) abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [],
  );

  /** Add the user's message and an empty assistant reply, then stream into it. */
  const send = useCallback(
    (content: string) => {
      const user: Message = { id: newId("user"), role: "user", content };
      const assistantId = newId("assistant");
      setMessages((prev) => [
        ...prev,
        user,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          status: "streaming",
        },
      ]);
      void streamReply(assistantId, [...messages, user]);
    },
    [messages, streamReply],
  );

  const stop = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const retry = useCallback(() => {
    if (isStreaming) return;

    // Find the most recent assistant message.
    let index = messages.length - 1;
    while (index >= 0 && messages[index].role !== "assistant") index--;
    if (index === -1) return; // Nothing to retry yet.
    const assistantId = messages[index].id;

    // Clear the old text and show it as streaming again.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, content: "", status: "streaming" } : m,
      ),
    );
    // Everything before the reply, so the model answers the same question.
    void streamReply(assistantId, messages.slice(0, index));
  }, [messages, isStreaming, streamReply]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, isStreaming, send, stop, retry };
}
