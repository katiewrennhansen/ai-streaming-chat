export type MessageId = string;

// A deliberately minimal shape. Extend it as you design the state: for
// example a status for assistant replies (pending, streaming, stopped, error…)
// and any fields that only some statuses need.
export type Message = {
  id: MessageId;
  role: "user" | "assistant";
  content: string;
};
