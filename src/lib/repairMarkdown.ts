/**
 * Make a half-streamed markdown string render the way it will look once it is
 * finished, so the text doesn't flicker as chunks arrive.
 *
 * It is only used while a message is streaming. Finished messages render
 * their raw text unchanged.
 *
 * What it handles:
 * - An open ``` code fence: close it, so partial code renders as code instead
 *   of prose that suddenly turns into a code block.
 * - A dangling block marker on the last line (`-`, `1.`, `#`, `---`): hide it.
 *   A lone `-` under a paragraph is a setext heading underline, so without
 *   this the previous line briefly becomes a big heading.
 * - Unclosed inline markers in the last block (`**`, `*`, `_`, `` ` ``):
 *   close them, or drop an opener that has no text after it yet, so the
 *   reader never sees stray asterisks.
 */
export function repairMarkdown(source: string): string {
  if (!source) return source;

  // 1. Code fences. Inside an open fence nothing else applies.
  const fenceRe = /^ {0,3}```.*$/gm;
  let fenceCount = 0;
  let afterLastFence = 0;
  for (let match = fenceRe.exec(source); match; match = fenceRe.exec(source)) {
    fenceCount += 1;
    afterLastFence = match.index + match[0].length;
  }
  if (fenceCount % 2 === 1) {
    return source + (source.endsWith('\n') ? '' : '\n') + '```';
  }

  // 2. A dangling block marker on the final line.
  let text = source.replace(/(^|\n)[ \t]*(?:[-*+=_]+|\d+[.)]?|#{1,6})[ \t]*$/, '$1');

  // 3. Inline markers only need fixing in the last block. Earlier paragraphs
  //    are finished, and emphasis cannot cross a blank line or a code fence.
  const lastBlank = text.lastIndexOf('\n\n');
  const start = Math.max(lastBlank === -1 ? 0 : lastBlank + 2, Math.min(afterLastFence, text.length));
  text = text.slice(0, start) + repairInline(text.slice(start));

  return text;
}

type Marker = '**' | '__' | '*' | '_' | '`';

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function atLineStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === '\n') return true;
    if (text[i] !== ' ' && text[i] !== '\t') return false;
  }
  return true;
}

function repairInline(block: string): string {
  const open: { marker: Marker; index: number }[] = [];
  let i = 0;

  while (i < block.length) {
    const ch = block[i];

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '`') {
      const close = block.indexOf('`', i + 1);
      if (close === -1) {
        open.push({ marker: '`', index: i });
        break; // Everything after an open backtick is code, so stop scanning.
      }
      i = close + 1;
      continue;
    }

    if (ch === '*' || ch === '_') {
      // "* item" at the start of a line is a list bullet, not emphasis.
      if (ch === '*' && block[i + 1] === ' ' && atLineStart(block, i)) {
        i += 1;
        continue;
      }
      const marker = (block[i + 1] === ch ? ch + ch : ch) as Marker;
      // snake_case_words are not emphasis.
      if (ch === '_' && isWordChar(block[i - 1]) && isWordChar(block[i + marker.length])) {
        i += marker.length;
        continue;
      }
      const existing = open.map((o) => o.marker).lastIndexOf(marker);
      if (existing === -1) open.push({ marker, index: i });
      else open.length = existing; // Closing it also closes anything opened inside it.
      i += marker.length;
      continue;
    }

    i += 1;
  }

  if (open.length === 0) return block;

  let out = block;
  // An opener with no text after it yet ("Hello **") would render as literal
  // asterisks or empty bold. Drop it until its content arrives.
  while (open.length > 0) {
    const last = open[open.length - 1];
    if (out.slice(last.index + last.marker.length).trim() !== '') break;
    out = out.slice(0, last.index);
    open.pop();
  }
  if (open.length === 0) return out;

  // A closing marker can't follow whitespace ("**bold **" doesn't render as bold).
  out = out.replace(/\s+$/, '');
  return out + open.reverse().map((o) => o.marker).join('');
}

/** A rough markdown-to-plain-text pass, for screen reader announcements. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/^ {0,3}```.*$/gm, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
