import { Alert, Button, Card, Spinner } from "@heroui/react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import { repairMarkdown } from "../lib/repairMarkdown";
import {
  assertNever,
  type AssistantMessage,
  type Message,
  type MessageId,
} from "../lib/types";

interface Props {
  message: Message;
  onRetry: (id: MessageId) => void;
}

// A blinking block caret after the last element of a streaming reply.
const STREAMING_CARET =
  "[&>:last-child]:after:ml-0.5 [&>:last-child]:after:inline-block [&>:last-child]:after:h-[1em] [&>:last-child]:after:w-[0.5em] [&>:last-child]:after:bg-accent [&>:last-child]:after:align-text-bottom [&>:last-child]:after:content-[''] [&>:last-child]:after:animate-pulse motion-reduce:[&>:last-child]:after:animate-none";

function StatusFooter({
  message,
  onRetry,
}: {
  message: AssistantMessage;
  onRetry: Props["onRetry"];
}) {
  switch (message.status) {
    case "pending":
    case "streaming":
    case "complete":
      return null;
    case "stopped":
      return (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-2 text-sm text-muted">
          <span>
            {message.content ? "Stopped." : "Stopped before any text arrived."}
          </span>
          <Button size="sm" variant="ghost" onPress={() => onRetry(message.id)}>
            Regenerate
          </Button>
        </div>
      );
    case "error":
      return (
        <Alert status="danger" className="mt-3">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Response interrupted</Alert.Title>
            <Alert.Description>{message.error}</Alert.Description>
          </Alert.Content>
          <Button
            size="sm"
            variant="danger-soft"
            onPress={() => onRetry(message.id)}
          >
            Retry
          </Button>
        </Alert>
      );
    default:
      return assertNever(message);
  }
}

/**
 * Memoized. The reducer only creates a new object for the message that
 * changed, so finished messages skip rendering while another one streams.
 */
export const MessageItem = memo(function MessageItem({
  message,
  onRetry,
}: Props) {
  console.log(message);
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <span className="sr-only">You said:</span>
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-accent-soft px-4 py-2.5 text-accent-soft-foreground">
          {message.content}
        </div>
      </li>
    );
  }

  const live = message.status === "pending" || message.status === "streaming";
  const faded = message.status === "stopped" || message.status === "error";

  return (
    <li aria-busy={live}>
      <span className="sr-only">Assistant:</span>
      <Card>
        <Card.Content>
          {message.status === "pending" ? (
            <Spinner size="sm" aria-label="Assistant is thinking" />
          ) : (
            <div
              className={[
                // `prose` styles the markdown. The code: overrides drop the
                // literal backticks it adds around inline code.
                "prose prose-sm max-w-none dark:prose-invert prose-code:before:content-none prose-code:after:content-none",
                message.status === "streaming" ? STREAMING_CARET : "",
                faded ? "opacity-85" : "",
              ].join(" ")}
            >
              <ReactMarkdown>
                {message.status === "streaming"
                  ? repairMarkdown(message.content)
                  : message.content}
              </ReactMarkdown>
            </div>
          )}
          <StatusFooter message={message} onRetry={onRetry} />
        </Card.Content>
      </Card>
    </li>
  );
});
