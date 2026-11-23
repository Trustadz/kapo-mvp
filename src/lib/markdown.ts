/**
 * Small, dependency-free Markdown subset used by the shared renderer.
 *
 * Kapo deliberately supports only the formatting its fields need:
 * paragraphs, hard line breaks, **bold**, *italic*, `code`, http(s) links and
 * unordered/ordered lists. Everything else is treated as text. Raw HTML is
 * never interpreted, and links are limited to http(s) URLs so a value can
 * never inject a script, event handler or `javascript:` URL.
 */

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { type: 'paragraph'; lines: MarkdownInline[][] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] };

const ESCAPABLE = new Set(['\\', '`', '*', '[', ']', '(', ')', '_', '#', '-', '+', '.', '!']);

/** Only absolute http(s) URLs are linkable; everything else is rejected. */
export function safeMarkdownUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function findClosing(source: string, from: number, marker: string): number {
  let index = source.indexOf(marker, from);
  while (index !== -1 && source[index - 1] === '\\') {
    index = source.indexOf(marker, index + marker.length);
  }
  return index;
}

interface ParsedLink {
  label: string;
  url: string;
  length: number;
}

/**
 * Parses `[label](url)` from `start`, allowing balanced parentheses inside the
 * URL. Returns null for ordinary text. The URL itself is validated later.
 */
function parseLinkAt(source: string, start: number): ParsedLink | null {
  const labelEnd = source.indexOf(']', start + 1);
  if (labelEnd === -1 || source[labelEnd + 1] !== '(') return null;
  if (source.slice(start + 1, labelEnd).includes('\n')) return null;
  let depth = 0;
  for (let index = labelEnd + 2; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      if (depth === 0) {
        const url = source.slice(labelEnd + 2, index);
        if (!url || /\s/.test(url)) return null;
        return {
          label: source.slice(start + 1, labelEnd),
          url,
          length: index - start + 1,
        };
      }
      depth -= 1;
    }
  }
  return null;
}

function parseInline(source: string, depth = 0): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let text = '';
  let index = 0;

  const flushText = () => {
    if (text) {
      nodes.push({ type: 'text', value: text });
      text = '';
    }
  };

  while (index < source.length) {
    const char = source[index] as string;

    if (char === '\\' && index + 1 < source.length) {
      const next = source[index + 1] as string;
      if (ESCAPABLE.has(next)) {
        text += next;
        index += 2;
        continue;
      }
    }

    if (char === '`') {
      const end = source.indexOf('`', index + 1);
      if (end > index + 1) {
        flushText();
        nodes.push({ type: 'code', value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (char === '*' && depth < 8) {
      const strong = source.startsWith('**', index);
      const marker = strong ? '**' : '*';
      const end = findClosing(source, index + marker.length, marker);
      if (end > index + marker.length) {
        flushText();
        nodes.push({
          type: strong ? 'strong' : 'em',
          children: parseInline(source.slice(index + marker.length, end), depth + 1),
        });
        index = end + marker.length;
        continue;
      }
    }

    if (char === '[' && depth < 8) {
      const link = parseLinkAt(source, index);
      if (link) {
        const href = safeMarkdownUrl(link.url);
        flushText();
        if (href) {
          nodes.push({ type: 'link', href, children: parseInline(link.label, depth + 1) });
        } else {
          // Reject the URL entirely; render only the untrusted link label.
          nodes.push({ type: 'text', value: link.label });
        }
        index += link.length;
        continue;
      }
    }

    text += char;
    index += 1;
  }

  flushText();
  return nodes;
}

/** Parses the supported block syntax into a small render-ready AST. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', lines: paragraph.map((line) => parseInline(line)) });
    paragraph = [];
  };

  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = unordered ? null : /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const item = parseInline((unordered ?? ordered)?.[1] ?? '');
      const previous = blocks[blocks.length - 1];
      if (previous?.type === 'list' && previous.ordered === isOrdered) {
        previous.items.push(item);
      } else {
        blocks.push({ type: 'list', ordered: isOrdered, items: [item] });
      }
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

function inlineText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.value;
      return inlineText(node.children);
    })
    .join('');
}

/**
 * Plain-text projection for compact places (collection cards/meta) where block
 * markup would distort the row. Keeps the words, drops the markers.
 */
export function stripMarkdown(source: string | null | undefined): string {
  if (!source) return '';
  const blocks = parseMarkdown(source);
  return blocks
    .map((block) =>
      block.type === 'paragraph'
        ? block.lines.map(inlineText).join(' ')
        : block.items.map(inlineText).join(' '),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
