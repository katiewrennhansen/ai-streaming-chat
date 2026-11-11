import { Alert, Button, Chip } from "@heroui/react";
import { useCallback } from "react";
import { Composer } from "./components/Composer";
import { MessageItem } from "./components/MessageItem";
import { useChat } from "./hooks/useChat";
import { useServerStatus } from "./hooks/useServerStatus";
import { useStickToBottom } from "./hooks/useStickToBottom";

const SUGGESTIONS = [
  "Explain how HTTP streaming works",
  "Write a TypeScript debounce function",
  "Give me 3 dinner ideas",
];

export default function App() {
  const chat = useChat();
  const status = useServerStatus();
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom();
  const { send } = chat;

  const handleSend = useCallback(
    (text: string) => {
      scrollToBottom("auto"); // Sending a message always means "follow the reply".
      send(text);
    },
    [send, scrollToBottom],
  );

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col px-4">
      <header className="flex items-center justify-between gap-3 border-b border-border py-3.5">
        <h1 className="text-base font-semibold">Chat</h1>
        {status.data?.ready && (
          <Chip size="sm" variant="soft">
            {status.data.model}
          </Chip>
        )}
      </header>

      {/* Warn before the first message if the server isn't usable. */}
      {(status.isError || status.data?.ready === false) && (
        <Alert status="warning" className="mt-3">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {status.isError
                ? "Can't reach the API server"
                : "OpenAI is not set up"}
            </Alert.Title>
            <Alert.Description>
              {status.data?.ready === false
                ? status.data.problem
                : "Start it with npm run dev, then come back to this tab."}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <div
        className="flex-1 overflow-y-auto overflow-anchor-none"
        ref={scrollRef}
      >
        <ol
          className="flex min-h-full flex-col gap-4 py-5"
          ref={contentRef}
          aria-label="Conversation"
        >
          {chat.messages.length === 0 && (
            <li className="m-auto text-center text-muted">
              <p className="mb-3">Try one of these:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="secondary"
                    onPress={() => handleSend(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </li>
          )}
          {chat.messages.map((m) => (
            <MessageItem key={m.id} message={m} onRetry={chat.retry} />
          ))}
        </ol>
      </div>

      <div className="relative pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        {!isAtBottom && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 shadow-md"
            onPress={() => scrollToBottom()}
          >
            {chat.isStreaming ? "New text below" : "Jump to latest"} ↓
          </Button>
        )}
        <Composer
          isStreaming={chat.isStreaming}
          onSend={handleSend}
          onStop={chat.stop}
        />
      </div>

      {/* The only live region. The transcript itself is not live, otherwise a
          screen reader would try to read every token as it arrives. */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {chat.announcement}
      </div>
    </div>
  );
}
