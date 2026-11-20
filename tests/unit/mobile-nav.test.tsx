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

const { MobileNav, favoriteMenuItems } = await import('@/components/shell/MobileNav');

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
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('href="/search"');
    // The four remaining navigation destinations stay intact.
    expect(html).toContain('href="/"');
    expect(html).toContain(`href="/p/${ROOT_ID}"`);
    expect(html).toContain('href="/inbox"');
  });

  it('builds a favorite menu item with a project link and title', () => {
    const items = favoriteMenuItems(FAVORITES);
    expect(items).toEqual([
      {
        id: FAVORITES[0]!.id,
        label: 'Home improvement',
        icon: 'star',
        href: `/p/${FAVORITES[0]!.id}`,
      },
      {
        id: FAVORITES[1]!.id,
        label: 'Household',
        icon: 'star',
        href: `/p/${FAVORITES[1]!.id}`,
      },
    ]);
  });

  it('builds no items for an empty favorites list', () => {
    expect(favoriteMenuItems([])).toEqual([]);
  });
});
