import { Card, CardContent, Spinner } from "@heroui/react";
import clsx from "clsx";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import { repairMarkdown } from "../lib/repairMarkdown";
import { AssistantStatuses, type Message, type MessageId } from "../lib/types";
import { StatusFooter } from "./StatusFooter";

type MessageItemProps = {
  message: Message;
  onRetry: (id: MessageId) => void;
};

// A blinking block caret after the last element of a streaming reply.
const STREAMING_CARET =
  "[&>:last-child]:after:ml-0.5 [&>:last-child]:after:inline-block [&>:last-child]:after:h-[1em] [&>:last-child]:after:w-[0.5em] [&>:last-child]:after:bg-accent [&>:last-child]:after:align-text-bottom [&>:last-child]:after:content-[''] [&>:last-child]:after:animate-pulse motion-reduce:[&>:last-child]:after:animate-none";

/**
 * Memoized. The reducer only creates a new object for the message that
 * changed, so finished messages skip rendering while another one streams.
 */
export const MessageItem = memo(function MessageItem({
  message,
  onRetry,
}: MessageItemProps) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <span className="sr-only">You said:</span>
        <Card className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-accent-soft px-4 py-2.5 text-accent-soft-foreground">
          {message.content}
        </Card>
      </li>
    );
  }

  const live =
    message.status === AssistantStatuses.Pending ||
    message.status === AssistantStatuses.Streaming;
  const faded =
    message.status === AssistantStatuses.Stopped ||
    message.status === AssistantStatuses.Error;

  const assistantResponse =
    message.status === AssistantStatuses.Streaming
      ? repairMarkdown(message.content)
      : message.content;

  return (
    <li aria-busy={live}>
      <span className="sr-only">Assistant:</span>
      <Card>
        <CardContent>
          {message.status === AssistantStatuses.Pending ? (
            <Spinner size="sm" aria-label="Assistant is thinking" />
          ) : (
            <div
              className={clsx(
                // `prose` styles the markdown. The code: overrides drop the
                // literal backticks it adds around inline code.
                "prose prose-sm max-w-none dark:prose-invert prose-code:before:content-none prose-code:after:content-none",
                message.status === AssistantStatuses.Streaming &&
                  STREAMING_CARET,
                faded && "opacity-85",
              )}
            >
              <ReactMarkdown>{assistantResponse}</ReactMarkdown>
            </div>
          )}
          <StatusFooter message={message} onRetry={onRetry} />
        </CardContent>
      </Card>
    </li>
  );
});
