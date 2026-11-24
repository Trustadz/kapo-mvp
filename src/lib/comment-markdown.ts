/**
 * Tiny comment formatter: paragraphs, line breaks, bold, italic, underline and
 * strikethrough only. It deliberately does not interpret HTML, links, lists or
 * code, matching the basic comments PoC.
 *
 *   **bold**   *italic*   __underline__   ~~strikethrough~~
 */

export type CommentInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: CommentInline[] }
  | { type: 'em'; children: CommentInline[] }
  | { type: 'underline'; children: CommentInline[] }
  | { type: 'strike'; children: CommentInline[] };

export interface CommentParagraph {
  lines: CommentInline[][];
}

const MARKERS = [
  { marker: '**', type: 'strong' as const },
  { marker: '__', type: 'underline' as const },
  { marker: '~~', type: 'strike' as const },
  { marker: '*', type: 'em' as const },
];

function findClosing(source: string, from: number, marker: string): number {
  let index = source.indexOf(marker, from);
  while (index !== -1 && source[index - 1] === '\\') {
    index = source.indexOf(marker, index + marker.length);
  }
  return index;
}

function parseInline(source: string, depth = 0): CommentInline[] {
  if (depth > 8) return [{ type: 'text', value: source }];
  const nodes: CommentInline[] = [];
  let text = '';
  let index = 0;

  const flush = () => {
    if (text) {
      nodes.push({ type: 'text', value: text });
      text = '';
    }
  };

  while (index < source.length) {
    const char = source[index] as string;
    if (char === '\\' && index + 1 < source.length) {
      const next = source[index + 1] as string;
      if ('\\*_~'.includes(next)) {
        text += next;
        index += 2;
        continue;
      }
    }

    let matched = false;
    for (const { marker, type } of MARKERS) {
      if (!source.startsWith(marker, index)) continue;
      const end = findClosing(source, index + marker.length, marker);
      if (end <= index + marker.length) continue;
      flush();
      nodes.push({
        type,
        children: parseInline(source.slice(index + marker.length, end), depth + 1),
      });
      index = end + marker.length;
      matched = true;
      break;
    }
    if (matched) continue;

    text += char;
    index += 1;
  }

  flush();
  return nodes;
}

/** Parses blank-line paragraphs; each line is rendered with a hard break. */
export function parseCommentMarkdown(source: string): CommentParagraph[] {
  const paragraphs: CommentParagraph[] = [];
  let lines: CommentInline[][] = [];
  const flush = () => {
    if (lines.length > 0) {
      paragraphs.push({ lines });
      lines = [];
    }
  };

  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    lines.push(parseInline(line));
  }
  flush();
  return paragraphs;
}

function inlineText(nodes: CommentInline[]): string {
  return nodes
    .map((node) => (node.type === 'text' ? node.value : inlineText(node.children)))
    .join('');
}

/** Plaintext projection used for fallback rendering and future search. */
export function stripCommentMarkdown(source: string | null | undefined): string {
  if (!source) return '';
  return parseCommentMarkdown(source)
    .map((paragraph) => paragraph.lines.map(inlineText).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
