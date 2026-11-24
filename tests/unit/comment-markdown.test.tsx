import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { commentMarkdownProviderClient } from '@/components/addons/comments-markdown';
import { stripCommentMarkdown } from '@/lib/comment-markdown';

const Renderer = commentMarkdownProviderClient.Renderer;

function render(value: string): string {
  return renderToStaticMarkup(<Renderer value={value} />);
}

describe('comment Markdown', () => {
  it('renders bold, italic, underline and strikethrough', () => {
    const html = render('**bold** *italic* __under__ ~~gone~~');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>under</u>');
    expect(html).toContain('<del>gone</del>');
  });

  it('keeps paragraphs and hard line breaks', () => {
    const html = render('first line\nsecond line\n\nsecond paragraph');
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain('<br/>');
  });

  it('escapes HTML and does not interpret links or lists', () => {
    const html = render('<script>alert(1)</script>\n\n- not a list\n\n[not](https://example.com)');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<a ');
    expect(html).toContain('[not](https://example.com)');
  });

  it('produces a plaintext projection', () => {
    expect(stripCommentMarkdown('**Bold** and __under__\n~~gone~~')).toBe('Bold and under gone');
  });
});
