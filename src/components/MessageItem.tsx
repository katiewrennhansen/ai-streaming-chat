import { Alert, Button, Card, CardContent } from "@heroui/react";
import { useChat } from "../hooks/useChat";
import ReactMarkdown from "react-markdown";
import { repairMarkdown } from "../lib/repairMarkdown";
import type { Message } from "../lib/types";

type MessageItemProps = {
  message: Message;
  chat: ReturnType<typeof useChat>;
};

export function MessageItem({ message, chat }: MessageItemProps) {
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

  return (
    <li>
      <span className="sr-only">Assistant:</span>
      <Card>
        <CardContent>
          {message.content === "" && <p>Loading...</p>}
          <div className="prose prose-sm max-w-none dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
            <ReactMarkdown>{repairMarkdown(message.content)}</ReactMarkdown>
          </div>
          {(message.status === "stopped" || message.status === "error") && (
            <Alert status="danger" className="mt-3">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Error</Alert.Title>
                <Alert.Description className="flex flex-row justify-between items-center w-full">
                  {message.status === "error" &&
                    "Something went wrong while generating the response."}
                  {message.status === "stopped" && "Generation stopped."}
                  <Button onPress={chat.retry}>Retry</Button>
                </Alert.Description>
              </Alert.Content>
            </Alert>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
