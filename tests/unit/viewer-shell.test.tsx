import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthUser } from '@/lib/types';

/**
 * Viewer shell (product.md §6, build-spec §1): application Viewers are
 * read-only, so the global capture input and the mobile Add action are not
 * rendered at all.
 * Server-side authorisation is covered by the API tests (Viewer POST/PATCH/
 * trash/move/reorder/members/settings all return 403).
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
}));

const { TopBar } = await import('@/components/shell/TopBar');
const { MobileNav } = await import('@/components/shell/MobileNav');

function user(appRole: AuthUser['appRole']): AuthUser {
  return {
    id: `user-${appRole}`,
    username: appRole,
    email: `${appRole}@example.com`,
    avatar: null,
    appRole,
    landingPage: 'home',
    appearance: 'system',
    dashboard: [
      { id: 'inbox', visible: true },
      { id: 'recent', visible: true },
    ],
    showArchived: false,
    createdAt: new Date(0).toISOString(),
  };
}

const ROOT_ID = '00000000-0000-4000-8000-000000000001';

describe('desktop top bar capture', () => {
  it('hides the capture input from an application Viewer', () => {
    const html = renderToStaticMarkup(<TopBar user={user('viewer')} rootProjectId={ROOT_ID} />);
    expect(html).not.toContain('Add a project to Root');
    expect(html).not.toContain('capture-title');
    expect(html).not.toMatch(/<input[^>]+placeholder="Add a project to Root/);
    // Search remains available to read-only users.
    expect(html).toContain('/search');
  });

  it('renders the capture input for a project User and an Admin', () => {
    for (const role of ['user', 'admin'] as const) {
      const html = renderToStaticMarkup(<TopBar user={user(role)} rootProjectId={ROOT_ID} />);
      expect(html).toContain('capture-title');
      expect(html).toContain('Add a project to Root');
      expect(html).not.toContain('Viewers can browse only.');
    }
  });
});

describe('mobile bottom bar', () => {
  it('hides the Add action from an application Viewer', () => {
    const html = renderToStaticMarkup(
      <MobileNav rootProjectId={ROOT_ID} favorites={[]} canCapture={false} />,
    );
    expect(html).not.toContain('Add a project to Root');
    expect(html).not.toContain('>Add<');
    // The read-only tabs remain; Search lives in the top header instead.
    expect(html).toContain('/inbox');
    expect(html).toContain('>Favorites<');
    expect(html).not.toContain('/search');
  });

  it('renders the Add action when capture is allowed', () => {
    const html = renderToStaticMarkup(
      <MobileNav rootProjectId={ROOT_ID} favorites={[]} canCapture />,
    );
    expect(html).toContain('Add a project to Root');
    expect(html).toContain('>Add<');
  });
});
