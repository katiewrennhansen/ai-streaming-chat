export type MessageId = string;

export interface UserMessage {
  id: MessageId;
  role: 'user';
  content: string;
}

interface AssistantBase {
  id: MessageId;
  role: 'assistant';
  replyTo: MessageId;
}

/**
 * Each status is its own variant, so the type system knows which fields exist
 * in which state: only `error` has an error message, and `pending` is
 * guaranteed to have no content yet. A `switch (message.status)` narrows
 * automatically, and `assertNever` makes a missing case a compile error.
 */
export type AssistantMessage =
  | (AssistantBase & { status: 'pending'; content: '' })
  | (AssistantBase & { status: 'streaming'; content: string })
  | (AssistantBase & { status: 'complete'; content: string })
  | (AssistantBase & { status: 'stopped'; content: string })
  | (AssistantBase & { status: 'error'; content: string; error: string });

export type Message = UserMessage | AssistantMessage;

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
