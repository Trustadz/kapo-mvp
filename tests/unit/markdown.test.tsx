import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '@/components/ui/Markdown';
import { MarkdownTextarea } from '@/components/ui/MarkdownTextarea';
import { safeMarkdownUrl, stripMarkdown } from '@/lib/markdown';

/**
 * The shared Markdown renderer is deliberately a small, safe subset. These
 * tests pin the supported formatting and, more importantly, that HTML, script
 * text and unsafe URLs never become live markup.
 */

function render(value: string): string {
  return renderToStaticMarkup(<Markdown value={value} />);
}

describe('Markdown renderer', () => {
  it('renders paragraphs, line breaks, emphasis, code and links', () => {
    const html = render(
      '**bold** and *italic* with `code`\nsecond line\n\n[Kapo](https://example.com/path?q=1)',
    );
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<br/>');
    expect(html).toContain('href="https://example.com/path?q=1"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it('renders unordered and ordered lists', () => {
    const html = render('- one\n- two\n\n1. first\n2. second');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
  });

  it('escapes raw HTML instead of injecting it', () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('rejects javascript:, data: and other non-http(s) links', () => {
    const html = render(
      '[script](javascript:alert(1)) [data](data:text/html,hi) [file](file:///etc/passwd)',
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('file://');
    expect(html).not.toContain('<a ');
    expect(html).toContain('script');
    expect(html).toContain('data');
  });

  it('accepts only absolute http(s) URLs', () => {
    expect(safeMarkdownUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeMarkdownUrl('HTTP://example.com')).toBe('http://example.com/');
    expect(safeMarkdownUrl('javascript:alert(1)')).toBeNull();
    expect(safeMarkdownUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeMarkdownUrl('data:text/html,hi')).toBeNull();
    expect(safeMarkdownUrl('/relative')).toBeNull();
    expect(safeMarkdownUrl('')).toBeNull();
  });

  it('strips markers for compact plain-text projection', () => {
    expect(
      stripMarkdown('**bold** *italic* `code` [link](https://example.com)\n\n- one\n- two'),
    ).toBe('bold italic code link one two');
  });
});

describe('MarkdownTextarea', () => {
  it('provides Edit/Preview tabs with the editor label and preview markup', () => {
    const html = renderToStaticMarkup(
      <MarkdownTextarea label="Notes" value="**bold** and *italic*" onChange={() => {}} />,
    );
    expect(html).toContain('aria-label="Markdown editor mode"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('>Edit<');
    expect(html).toContain('>Preview<');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('for="markdown-textarea-');
    expect(html).toContain('Simple Markdown');
  });

  it('shows an empty-state preview and associates an error with the field', () => {
    const html = renderToStaticMarkup(
      <MarkdownTextarea
        label="Notes"
        value=""
        onChange={() => {}}
        error="Check this field."
      />,
    );
    expect(html).toContain('Nothing to preview yet.');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Check this field.');
    expect(html).toContain('aria-invalid="true"');
  });
});
