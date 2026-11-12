import type { ChatHistoryItem, StreamEvent } from "./protocol";

/** A failure we can explain to the user. Its message is shown in the chat. */
export class StreamFailure extends Error {
  name = "StreamFailure";
}

/**
 * Stream a reply from our server (which talks to OpenAI), as an async
 * generator of text chunks.
 *
 * - Abort: rejects with the AbortError, and useChat history that into `stopped`.
 * - Any failure, including the connection closing before a `done` event,
 *   throws StreamFailure, which becomes `error` with the partial text kept.
 */
export async function* openAIStream(
  history: ChatHistoryItem[],
  signal: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new StreamFailure("Couldn't reach the API server.");
  }

  if (!res.ok || !res.body) {
    throw new StreamFailure(
      res.status >= 500
        ? `Server error (${res.status}). Is the API server running?`
        : `Request failed (${res.status}).`,
    );
  }

  let streamed = "";
  let finished = false;
  const readableStream = res.body.pipeThrough(new TextDecoderStream());

  // `for await` over the stream reads it piece by piece and stops when it
  // ends. If the loop exits early (an error event, a throw, or the consumer
  // of this generator bailing out), the stream is cancelled automatically,
  // which tells the server to cancel the OpenAI request.

  try {
    for await (const chunk of readableStream) {
      streamed += chunk;
      const lines = streamed.split("\n");
      streamed = lines.pop()!; // The last piece may be an incomplete line.

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;

        if (event.type === "delta") yield event.text;
        else if (event.type === "error") throw new StreamFailure(event.message);
        else finished = true;
      }
    }
  } catch (err) {
    // Our own failures and Stop pass through. Anything else came from
    // reading the stream, which means the connection broke.
    if (err instanceof StreamFailure || signal.aborted) throw err;
    throw new StreamFailure("The connection dropped mid-reply.");
  }

  if (!finished)
    throw new StreamFailure("The connection closed before the reply finished.");
}
