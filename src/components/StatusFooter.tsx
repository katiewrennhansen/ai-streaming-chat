import { Alert, Button } from "@heroui/react";
import {
  AssistantStatuses,
  assertNever,
  type AssistantMessage,
  type MessageId,
} from "../lib/types";

type StatusFooterProps = {
  message: AssistantMessage;
  onRetry: (id: MessageId) => void;
};

/**
 * The strip under an assistant reply that explains why it ended early, with
 * a button to try again. Renders nothing while a reply is pending, streaming,
 * or complete.
 *
 * The `switch` covers every status, and `assertNever` makes a status added
 * later without a case here a compile error.
 */
export const StatusFooter = ({ message, onRetry }: StatusFooterProps) => {
  const handleRetry = () => onRetry(message.id);

  switch (message.status) {
    case AssistantStatuses.Pending:
    case AssistantStatuses.Streaming:
    case AssistantStatuses.Complete:
      return null;
    case AssistantStatuses.Stopped:
      return (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-2 text-sm text-muted">
          <span>
            {message.content ? "Stopped." : "Stopped before any text arrived."}
          </span>
          <Button size="sm" variant="ghost" onPress={handleRetry}>
            Regenerate
          </Button>
        </div>
      );
    case AssistantStatuses.Error:
      return (
        <Alert status="danger" className="mt-3">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Response interrupted</Alert.Title>
            <Alert.Description>{message.error}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="danger-soft" onPress={handleRetry}>
            Retry
          </Button>
        </Alert>
      );
    default:
      return assertNever(message);
  }
};
