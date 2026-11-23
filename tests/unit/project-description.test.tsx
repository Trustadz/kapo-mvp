import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectDescription } from '@/components/projects/ProjectDescription';
import type { ProjectDescriptionData } from '@/lib/description';

function render(description: ProjectDescriptionData, canEdit = true): string {
  return renderToStaticMarkup(
    <ProjectDescription
      projectId="project-1"
      description={description}
      canEdit={canEdit}
      notify={() => {}}
      onSaved={() => {}}
    />,
  );
}

const provider: ProjectDescriptionData['provider'] = {
  identifier: 'description-markdown',
  name: 'Markdown description',
  version: '1.0.0',
  reads: ['markdown@1'],
  writes: ['markdown@1'],
};

describe('ProjectDescription', () => {
  it('offers an empty description to editors', () => {
    const html = render({ provider, record: null, canEdit: true, unsupportedFormat: false });
    expect(html).toContain('Description');
    expect(html).toContain('No description yet.');
    expect(html).toContain('Add description');
  });


  it('keeps the edit action available when no provider is active', () => {
    const html = render({
      provider: null,
      record: {
        body: 'Plain notes',
        format: 'text@1',
        plaintext: 'Plain notes',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      canEdit: true,
      unsupportedFormat: false,
    });
    expect(html).toContain('Plain notes');
    expect(html).toContain('Edit description');
    expect(html).not.toContain('No description provider is active');
  });

  it('renders plaintext when the provider cannot read the stored format', () => {
    const html = render({
      provider,
      record: {
        body: '<p>HTML body</p>',
        format: 'html@1',
        plaintext: 'HTML body',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      canEdit: true,
      unsupportedFormat: true,
    });
    expect(html).toContain('HTML body');
    expect(html).toContain('cannot edit this format');
    expect(html).not.toContain('Edit description');
  });

  it('keeps read-only viewers from editing', () => {
    const html = render(
      {
        provider,
        record: {
          body: '**Hello**',
          format: 'markdown@1',
          plaintext: 'Hello',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        canEdit: false,
        unsupportedFormat: false,
      },
      false,
    );
    expect(html).toContain('<strong>Hello</strong>');
    expect(html).not.toContain('Edit description');
  });
});
