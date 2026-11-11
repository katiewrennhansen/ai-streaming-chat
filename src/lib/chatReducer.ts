import { AssistantStatuses, type AssistantMessage, type Message, type MessageId, type UserMessage } from './types';

type ChatAction =
  | { type: 'send'; user: UserMessage; assistantId: MessageId }
  | { type: 'append'; id: MessageId; text: string }
  | { type: 'complete'; id: MessageId }
  | { type: 'fail'; id: MessageId; error: string }
  | { type: 'stop'; id: MessageId }
  | { type: 'retry'; id: MessageId };

export type ChatState = Message[];

function base(m: AssistantMessage) {
  return { id: m.id, role: m.role, replyTo: m.replyTo };
}

/**
 * Replace one assistant message. Every other message keeps the same object
 * identity, which is what lets React.memo skip re-rendering them.
 */
function updateAssistant(
  state: ChatState,
  id: MessageId,
  update: (m: AssistantMessage) => AssistantMessage,
): ChatState {
  // The message being changed is almost always the last one, so search from the end.
  for (let i = state.length - 1; i >= 0; i--) {
    const m = state[i];
    if (m.id !== id) continue;
    if (m.role !== 'assistant') return state;
    const next = update(m);
    if (next === m) return state;
    const copy = state.slice();
    copy[i] = next;
    return copy;
  }
  return state;
}

/**
 * The state machine for an assistant message:
 *
 *   pending ──append──▶ streaming ──complete──▶ complete
 *      │                   │
 *      ├──stop / fail──────┴──▶ stopped / error ──retry──▶ pending
 *
 * Invalid transitions (such as a late chunk arriving after Stop) are ignored
 * instead of corrupting the message.
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send': {
      const assistant: AssistantMessage = {
        id: action.assistantId,
        role: 'assistant',
        replyTo: action.user.id,
        status: AssistantStatuses.Pending,
        content: '',
      };
      return [...state, action.user, assistant];
    }

    case 'append':
      return updateAssistant(state, action.id, (m) =>
        m.status === AssistantStatuses.Pending || m.status === AssistantStatuses.Streaming
          ? { ...base(m), status: AssistantStatuses.Streaming, content: m.content + action.text }
          : m,
      );

    case 'complete':
      return updateAssistant(state, action.id, (m) =>
        m.status === AssistantStatuses.Pending || m.status === AssistantStatuses.Streaming
          ? { ...base(m), status: AssistantStatuses.Complete, content: m.content }
          : m,
      );

    case 'fail':
      // Keep the partial text. Wiping it would throw away what the user was reading.
      return updateAssistant(state, action.id, (m) =>
        m.status === AssistantStatuses.Pending || m.status === AssistantStatuses.Streaming
          ? { ...base(m), status: AssistantStatuses.Error, content: m.content, error: action.error }
          : m,
      );

    case 'stop':
      return updateAssistant(state, action.id, (m) =>
        m.status === AssistantStatuses.Pending || m.status === AssistantStatuses.Streaming
          ? { ...base(m), status: AssistantStatuses.Stopped, content: m.content }
          : m,
      );

    case 'retry':
      return updateAssistant(state, action.id, (m) =>
        m.status === AssistantStatuses.Error || m.status === AssistantStatuses.Stopped
          ? { ...base(m), status: AssistantStatuses.Pending, content: '' }
          : m,
      );
  }
}
