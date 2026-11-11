export type MessageId = string;

export type UserMessage = {
  id: MessageId;
  role: "user";
  content: string;
};

export const AssistantStatuses = {
  Pending: "pending",
  Streaming: "streaming",
  Complete: "complete",
  Stopped: "stopped",
  Error: "error",
} as const;

export type AssistantStatus =
  (typeof AssistantStatuses)[keyof typeof AssistantStatuses];

type AssistantBase = {
  id: MessageId;
  role: "assistant";
  replyTo: MessageId;
};

/**
 * Each status is its own variant, so the type system knows which fields exist
 * in which state: only `error` has an error message, and `pending` is
 * guaranteed to have no content yet. A `switch (message.status)` narrows
 * automatically, and `assertNever` makes a missing case a compile error.
 */
export type AssistantMessage =
  | (AssistantBase & {
      status: typeof AssistantStatuses.Pending;
      content: "";
    })
  | (AssistantBase & {
      status:
        | typeof AssistantStatuses.Streaming
        | typeof AssistantStatuses.Complete
        | typeof AssistantStatuses.Stopped;
      content: string;
    })
  | (AssistantBase & {
      status: typeof AssistantStatuses.Error;
      content: string;
      error: string;
    });

export type Message = UserMessage | AssistantMessage;

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
