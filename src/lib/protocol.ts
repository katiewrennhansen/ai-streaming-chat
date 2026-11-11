// The wire format between our server and the browser. Imported by both.

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** GET /api/status: whether the server is set up to talk to OpenAI. */
export type ServerStatus = { ready: true; model: string } | { ready: false; problem: string };

/**
 * The server sends one JSON event per line (NDJSON). An explicit `done`
 * matters: without it, a connection that closes cleanly but early would look
 * like a finished reply.
 */
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
