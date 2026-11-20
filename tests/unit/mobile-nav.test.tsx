import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FavoriteProject } from '@/lib/types';

/**
 * Mobile bottom bar Favorites (issue #31): the Search tab is replaced by a
 * Favorites trigger that opens a sheet listing the user's favorite projects.
 * Search stays in the mobile top header.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
}));

const { MobileNav } = await import('@/components/shell/MobileNav');

const ROOT_ID = '00000000-0000-4000-8000-000000000001';

const FAVORITES: FavoriteProject[] = [
  { id: '00000000-0000-4000-8000-000000000010', title: 'Home improvement' },
  { id: '00000000-0000-4000-8000-000000000011', title: 'Household' },
];

function render(favorites: FavoriteProject[], canCapture = true): string {
  return renderToStaticMarkup(
    <MobileNav rootProjectId={ROOT_ID} favorites={favorites} canCapture={canCapture} />,
  );
}

describe('mobile bottom bar Favorites', () => {
  it('replaces the Search tab with a Favorites dialog trigger', () => {
    const html = render(FAVORITES);
    expect(html).toContain('aria-label="Mobile navigation"');
    expect(html).toContain('>Favorites<');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('href="/search"');
    // The four remaining navigation destinations stay intact.
    expect(html).toContain('href="/"');
    expect(html).toContain(`href="/p/${ROOT_ID}"`);
    expect(html).toContain('href="/inbox"');
  });

  it('lists every favorite as a project link with its title', () => {
    const html = render(FAVORITES);
    for (const favorite of FAVORITES) {
      expect(html).toContain(`href="/p/${favorite.id}"`);
      expect(html).toContain(favorite.title);
    }
  });

  it('shows a clear empty state when the user has no favorites', () => {
    const html = render([]);
    expect(html).toContain('No favorites yet');
    expect(html).toContain('Open a project and tap Favorite to keep it here.');
    expect(html).not.toContain('href="/p/00000000-0000-4000-8000-000000000010"');
  });
});
