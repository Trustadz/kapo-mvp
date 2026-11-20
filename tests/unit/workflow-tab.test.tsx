import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectPageData, WorkflowViewData } from '@/components/projects/types';

/**
 * Workflow settings UI (issue #22):
 *
 * - Start and Finish rows cannot be deleted; the delete control says which
 *   role is in the way and that another row must take it over first.
 * - Remapping removed live statuses lives in a Dialog, not inline below the
 *   status list.
 *
 * Interaction is covered manually/e2e; this test pins the server-rendered
 * contract (disabled controls and dialog markup).
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
}));

const { WorkflowTab } = await import('@/components/projects/ProjectSettingsPage');

function status(
  id: string,
  name: string,
  position: number,
  isStart = false,
  isFinish = false,
) {
  return { id, parentId: 'project-1', name, position, isStart, isFinish };
}

const workflow: WorkflowViewData = {
  statuses: [
    status('status-start', 'To do', 0, true),
    status('status-doing', 'In progress', 1),
    status('status-finish', 'Done', 2, false, true),
  ],
  usage: {
    'status-start': { live: 1, trashed: 0 },
    'status-doing': { live: 3, trashed: 0 },
    'status-finish': { live: 2, trashed: 0 },
  },
  retired: [],
};

const data = { project: { id: 'project-1' } } as unknown as ProjectPageData;

function render(): string {
  return renderToStaticMarkup(
    <WorkflowTab data={data} workflow={workflow} notify={() => {}} refresh={() => {}} />,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buttonTag(html: string, ariaLabel: string): string {
  const tag = html.match(
    new RegExp(`<button(?=[^>]*aria-label="${escapeRegExp(ariaLabel)}")[^>]*>`),
  );
  if (!tag) throw new Error(`No button with aria-label "${ariaLabel}"`);
  return tag[0];
}

describe('workflow status rows', () => {
  it('blocks deleting Start and Finish statuses with an explanatory label', () => {
    const html = render();

    const startReason =
      'Cannot remove To do: it is the Start status. Choose another Start status first.';
    const startButton = buttonTag(html, startReason);
    expect(startButton).toContain('disabled=""');
    expect(startButton).toContain(`title="${startReason}"`);

    const finishReason =
      'Cannot remove Done: it is the Finish status. Choose another Finish status first.';
    const finishButton = buttonTag(html, finishReason);
    expect(finishButton).toContain('disabled=""');
    expect(finishButton).toContain(`title="${finishReason}"`);
  });

  it('keeps other statuses deletable', () => {
    const html = render();
    const button = buttonTag(html, 'Remove In progress');
    expect(button).not.toContain('disabled');
  });

  it('keeps the remap UI in a dialog that starts closed', () => {
    const html = render();

    const dialog = html.match(/<dialog[^>]*>/)?.[0];
    expect(dialog).toBeDefined();
    expect(dialog).not.toContain('open');
    expect(html).toContain('Map removed statuses');
    expect(html).toContain('Children in a removed status must be mapped to a kept status');
    expect(html).toContain('Confirm mapping');
    expect(html).not.toContain('Map removed statuses explicitly');
  });
});
