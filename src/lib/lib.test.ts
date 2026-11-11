import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAIStream, StreamFailure } from './openAIStream';
import { repairMarkdown } from './repairMarkdown';

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
