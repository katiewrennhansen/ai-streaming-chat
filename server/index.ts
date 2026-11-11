// A small proxy between the browser and OpenAI. The API key stays here, on
// the server, and never reaches the browser.
//
// Run with Node 22+ (type stripping): node --env-file-if-exists=.env server/index.ts

import express from 'express';
import OpenAI, { APIUserAbortError } from 'openai';
import type { ChatTurn, ServerStatus, StreamEvent } from '../src/lib/protocol.ts';

const PORT = Number(process.env.API_PORT ?? 8787);
const MODEL = process.env.OPENAI_MODEL;
const INSTRUCTIONS =
  'You are a helpful assistant in a chat UI. Format answers in Markdown when it helps readability.';

const MAX_TURNS = 100;
const MAX_CHARS_PER_TURN = 20_000;

// The client is created lazily, so a missing key shows up as a clear error
// in the chat instead of a crash at startup.
let client: OpenAI | null = null;
function getClient(): OpenAI {
  client ??= new OpenAI(); // Reads OPENAI_API_KEY from the environment.
  return client;
}

function configError(): string | null {
  if (!process.env.OPENAI_API_KEY) return 'OPENAI_API_KEY is not set. Add it to .env (see .env.example) and restart.';
  if (!MODEL) return 'OPENAI_MODEL is not set. Add it to .env (see .env.example) and restart.';
  return null;
}

function parseTurns(body: unknown): ChatTurn[] | null {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_TURNS) return null;
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (
      !m ||
      (m.role !== 'user' && m.role !== 'assistant') ||
      typeof m.content !== 'string' ||
      m.content.length > MAX_CHARS_PER_TURN
    ) {
      return null;
    }
    turns.push({ role: m.role, content: m.content });
  }
  return turns;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Lets the UI show which model is in use, or warn before the first message
// if the key or model is missing.
app.get('/api/status', (_req, res) => {
  const problem = configError();
  const status: ServerStatus = problem ? { ready: false, problem } : { ready: true, model: MODEL! };
  res.json(status);
});

app.post('/api/chat', async (req, res) => {
  const problem = configError();
  if (problem) {
    res.status(500).json({ error: problem });
    return;
  }
  const turns = parseTurns(req.body);
  if (!turns) {
    res.status(400).json({ error: 'Invalid request: expected { messages: [{ role, content }] }.' });
    return;
  }

  // When the browser disconnects (Stop, closed tab, simulated failure),
  // cancel the OpenAI request so we stop paying for tokens nobody will read.
  const upstream = new AbortController();
  res.on('close', () => upstream.abort());

  const send = (event: StreamEvent) => res.write(JSON.stringify(event) + '\n');

  try {
    const stream = await getClient().responses.create(
      { model: MODEL!, instructions: INSTRUCTIONS, input: turns, stream: true },
      { signal: upstream.signal },
    );

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    for await (const event of stream) {
      switch (event.type) {
        case 'response.output_text.delta':
          send({ type: 'delta', text: event.delta });
          break;
        case 'response.completed':
          send({ type: 'done' });
          break;
        case 'response.incomplete':
          send({
            type: 'error',
            message: `The reply was cut short (${event.response.incomplete_details?.reason ?? 'unknown reason'}).`,
          });
          break;
        case 'response.failed':
          send({ type: 'error', message: event.response.error?.message ?? 'The model failed to respond.' });
          break;
        case 'error':
          send({ type: 'error', message: event.message });
          break;
      }
    }
    res.end();
  } catch (err) {
    if (upstream.signal.aborted || err instanceof APIUserAbortError) return; // The client left. Nothing to send.
    console.error(err);
    const message =
      err instanceof OpenAI.APIError
        ? `OpenAI error${err.status ? ` ${err.status}` : ''}: ${err.message}`
        : res.headersSent
          ? 'Lost the connection to OpenAI mid-reply.'
          : 'Server error.';
    if (!res.headersSent) {
      res.status(502).json({ error: message });
    } else {
      send({ type: 'error', message });
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`API server on http://localhost:${PORT}`);
  const problem = configError();
  if (problem) console.warn(`Warning: ${problem} OpenAI mode won't work until then.`);
});
