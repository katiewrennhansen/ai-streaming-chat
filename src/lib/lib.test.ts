import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatReducer, type ChatState } from './chatReducer';
import { openAIStream, StreamFailure } from './openAIStream';
import { repairMarkdown } from './repairMarkdown';
import { AssistantStatuses } from './types';

/** A fake server response: NDJSON split into awkward network chunks. */
function mockFetch(body: string, init: { status?: number; chunkSize?: number } = {}) {
  const { status = 200, chunkSize = 7 } = init;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(body);
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status })));
}

const ndjson = (...events: object[]) => events.map((e) => JSON.stringify(e) + '\n').join('');
const history = [{ role: 'user' as const, content: 'hi' }];

async function collect(stream: AsyncGenerator<string>) {
  const chunks: string[] = [];
  try {
    for await (const c of stream) chunks.push(c);
    return { chunks, error: null as unknown };
  } catch (error) {
    return { chunks, error };
  }
}

describe('openAIStream', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('yields deltas, even when lines are split across network chunks', async () => {
    mockFetch(ndjson({ type: 'delta', text: 'Hello ' }, { type: 'delta', text: '**world**' }, { type: 'done' }));
    const { chunks, error } = await collect(openAIStream(history, new AbortController().signal));
    expect(error).toBeNull();
    expect(chunks.join('')).toBe('Hello **world**');
  });

  it('keeps partial text and fails on an error event', async () => {
    mockFetch(ndjson({ type: 'delta', text: 'Part' }, { type: 'error', message: 'Rate limited' }));
    const { chunks, error } = await collect(openAIStream(history, new AbortController().signal));
    expect(chunks).toEqual(['Part']);
    expect(error).toBeInstanceOf(StreamFailure);
    expect((error as Error).message).toBe('Rate limited');
  });

  it('treats a stream that ends without "done" as a failure', async () => {
    mockFetch(ndjson({ type: 'delta', text: 'Cut o' }));
    const { error } = await collect(openAIStream(history, new AbortController().signal));
    expect((error as Error).message).toMatch(/closed before the reply finished/);
  });

  it('shows the server error message for a failed request', async () => {
    mockFetch(JSON.stringify({ error: 'OPENAI_API_KEY is not set.' }), { status: 500 });
    const { error } = await collect(openAIStream(history, new AbortController().signal));
    expect((error as Error).message).toBe('OPENAI_API_KEY is not set.');
  });
});

describe('chatReducer', () => {
  const user = { id: 'u1', role: 'user' as const, content: 'hi' };
  const start = chatReducer([], { type: 'send', user, assistantId: 'a1' });
  const assistant = (s: ChatState) => s[1];

  it('goes pending → streaming → complete', () => {
    expect(assistant(start)).toMatchObject({ status: AssistantStatuses.Pending, content: '' });
    const s1 = chatReducer(start, { type: 'append', id: 'a1', text: 'Hel' });
    const s2 = chatReducer(s1, { type: 'append', id: 'a1', text: 'lo' });
    expect(assistant(s2)).toMatchObject({ status: AssistantStatuses.Streaming, content: 'Hello' });
    expect(assistant(chatReducer(s2, { type: 'complete', id: 'a1' }))).toMatchObject({ status: AssistantStatuses.Complete });
  });

  it('keeps partial text on error, and retry resets to pending', () => {
    const s1 = chatReducer(start, { type: 'append', id: 'a1', text: 'partial' });
    const failed = chatReducer(s1, { type: 'fail', id: 'a1', error: 'boom' });
    expect(assistant(failed)).toMatchObject({ status: AssistantStatuses.Error, content: 'partial', error: 'boom' });
    expect(assistant(chatReducer(failed, { type: 'retry', id: 'a1' }))).toMatchObject({ status: AssistantStatuses.Pending, content: '' });
  });

  it('ignores chunks that arrive after stop', () => {
    const s1 = chatReducer(start, { type: 'append', id: 'a1', text: 'abc' });
    const stopped = chatReducer(s1, { type: 'stop', id: 'a1' });
    expect(chatReducer(stopped, { type: 'append', id: 'a1', text: 'late' })).toBe(stopped);
  });

  it('keeps the identity of untouched messages (so memo works)', () => {
    const s1 = chatReducer(start, { type: 'append', id: 'a1', text: 'abc' });
    expect(s1[0]).toBe(start[0]);
  });
});

describe('repairMarkdown', () => {
  it.each([
    ['Some **bol', 'Some **bol**'],
    ['Some **bold** and *ital', 'Some **bold** and *ital*'],
    ['Trailing opener **', 'Trailing opener '],
    ['Word then space **bold ', 'Word then space **bold**'],
    ['Nested **bold *both', 'Nested **bold *both***'],
    ['Use `repairMar', 'Use `repairMar`'],
    ['snake_case_name is fine', 'snake_case_name is fine'],
    ['A paragraph\n-', 'A paragraph\n'],
    ['1. one\n2.', '1. one\n'],
    ['* bullet item', '* bullet item'],
    ['```ts\nconst x = 1', '```ts\nconst x = 1\n```'],
    ['```ts\nconst x = "**"\n```\nAfter', '```ts\nconst x = "**"\n```\nAfter'],
    ['First **para**\n\nSecond **op', 'First **para**\n\nSecond **op**'],
  ])('%j → %j', (input, expected) => {
    expect(repairMarkdown(input)).toBe(expected);
  });

  it('never leaves stray markers at any prefix of a real reply', () => {
    const full = 'Intro with **bold** and `code`.\n\n1. **First** item\n2. *Second* item\n\n```ts\nconst a = 1;\n```\nDone.';
    for (let i = 1; i <= full.length; i++) {
      const out = repairMarkdown(full.slice(0, i));
      const fences = (out.match(/^```/gm) ?? []).length;
      expect(fences % 2, `prefix ${i}`).toBe(0);
    }
  });
});
