import type { ChatTurn, StreamEvent } from "./protocol";

/** A failure we can explain to the user. Its message is shown in the chat. */
export class StreamFailure extends Error {
  name = "StreamFailure";
}

/**
 * Stream a reply from our server (which talks to OpenAI), as an async
 * generator of text chunks.
 *
 * - Abort: rejects with the AbortError, and useChat turns that into `stopped`.
 * - Any failure, including the connection closing before a `done` event,
 *   throws StreamFailure, which becomes `error` with the partial text kept.
 */
export async function* openAIStream(
  turns: ChatTurn[],
  signal: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: turns }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new StreamFailure("Couldn't reach the API server.");
  }

  if (!res.ok || !res.body) {
    const detail = await res
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => undefined);
    throw new StreamFailure(
      detail ??
        (res.status >= 500
          ? `Server error (${res.status}). Is the API server running?`
          : `Request failed (${res.status}).`),
    );
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let finished = false;

  try {
    while (true) {
      let result: ReadableStreamReadResult<string>;
      try {
        result = await reader.read();
      } catch (err) {
        if (signal.aborted) throw err;
        throw new StreamFailure("The connection dropped mid-reply.");
      }
      if (result.done) break;

      buffered += result.value;
      const lines = buffered.split("\n");
      buffered = lines.pop()!; // The last piece may be an incomplete line.

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === "delta") yield event.text;
        else if (event.type === "error") throw new StreamFailure(event.message);
        else finished = true;
      }
    }
  } finally {
    // Runs on normal end, error, or the consumer bailing out early. Closing
    // the body tells the server to cancel the OpenAI request.
    reader.cancel().catch(() => {});
  }

  if (!finished)
    throw new StreamFailure("The connection closed before the reply finished.");
}
