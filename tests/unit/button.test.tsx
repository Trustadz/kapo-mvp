import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@/components/ui/Button';

describe('Button loading label', () => {
  it('swaps the label for the loading label while busy', () => {
    const html = renderToStaticMarkup(
      <Button loading loadingLabel="Saving…">
        Save changes
      </Button>,
    );
    expect(html).toContain('Saving…');
    expect(html).not.toContain('Save changes');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
  });

  it('keeps the normal label when idle', () => {
    const html = renderToStaticMarkup(
      <Button loadingLabel="Saving…">Save changes</Button>,
    );
    expect(html).toContain('Save changes');
    expect(html).not.toContain('Saving…');
    expect(html).not.toContain('aria-busy');
  });
});
