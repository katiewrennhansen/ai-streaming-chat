import { Card, CardContent } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import type { Message } from "../lib/types";

type MessageItemProps = {
  message: Message;
};

export function MessageItem({ message }: MessageItemProps) {
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

  // TODO: show loading, stopped and error states, and a retry button.
  // `repairMarkdown` in ../lib/repairMarkdown.ts can tidy half-finished
  // markdown while a reply streams.
  return (
    <li>
      <span className="sr-only">Assistant:</span>
      <Card>
        <CardContent>
          {/* `prose` styles the markdown. The code: overrides drop the
              literal backticks it adds around inline code. */}
          <div className="prose prose-sm max-w-none dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
