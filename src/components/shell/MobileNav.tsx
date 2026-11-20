'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import type { FavoriteProject } from '@/lib/types';
import { CaptureForm } from './CaptureForm';
import styles from './MobileNav.module.css';

export interface MobileNavProps {
  rootProjectId: string | null;
  favorites: FavoriteProject[];
  /** Application Viewers are read-only; the Add capture action is hidden. */
  canCapture: boolean;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Mobile bottom bar: Home / Root / Add / Inbox / Favorites (build-spec §8). */
export function MobileNav({ rootProjectId, favorites, canCapture }: MobileNavProps) {
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);

  const close = () => setAddOpen(false);
  const closeFavorites = () => setFavoritesOpen(false);
  const favoriteProjectActive = favorites.some((favorite) =>
    isActive(pathname, `/p/${favorite.id}`),
  );
  const favoritesActive = favoritesOpen || favoriteProjectActive;

  return (
    <>
      <nav className={styles.bar} aria-label="Mobile navigation">
        <Link
          href="/"
          className={cn(styles.tab, pathname === '/' && styles.active)}
          aria-current={pathname === '/' ? 'page' : undefined}
        >
          <Icon name="home" size={22} />
          <span className={styles.label}>Home</span>
        </Link>
        {rootProjectId ? (
          <Link
            href={`/p/${rootProjectId}`}
            className={cn(styles.tab, isActive(pathname, `/p/${rootProjectId}`) && styles.active)}
            aria-current={isActive(pathname, `/p/${rootProjectId}`) ? 'page' : undefined}
          >
            <Icon name="account_tree" size={22} />
            <span className={styles.label}>Root</span>
          </Link>
        ) : null}
        {canCapture ? (
          <button
            type="button"
            className={cn(styles.tab, styles.addTab)}
            onClick={() => setAddOpen(true)}
            aria-label="Add a project to Root"
            aria-haspopup="dialog"
          >
            <Icon name="add" size={24} />
            <span className={styles.label}>Add</span>
          </button>
        ) : null}
        <Link
          href="/inbox"
          className={cn(styles.tab, isActive(pathname, '/inbox') && styles.active)}
          aria-current={isActive(pathname, '/inbox') ? 'page' : undefined}
        >
          <Icon name="inbox" size={22} />
          <span className={styles.label}>Inbox</span>
        </Link>
        <button
          type="button"
          className={cn(styles.tab, favoritesActive && styles.active)}
          onClick={() => setFavoritesOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={favoritesOpen}
        >
          <Icon name="star" size={22} filled={favoritesActive} />
          <span className={styles.label}>Favorites</span>
        </button>
      </nav>

      <Dialog
        open={favoritesOpen}
        onClose={closeFavorites}
        title="Favorites"
        description="Your starred projects."
        size="sm"
      >
        {favorites.length > 0 ? (
          <ul className={styles.favoriteList}>
            {favorites.map((favorite) => (
              <li key={favorite.id}>
                <Link
                  href={`/p/${favorite.id}`}
                  className={styles.favoriteLink}
                  onClick={closeFavorites}
                >
                  <Icon name="star" size={20} filled className={styles.favoriteIcon} />
                  <span className={styles.favoriteTitle}>{favorite.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="star"
            title="No favorites yet"
            description="Open a project and tap Favorite to keep it here."
          />
        )}
      </Dialog>

      {canCapture ? (
        <Dialog
          open={addOpen}
          onClose={close}
          title="Add a project"
          description="Creates a Root child in Inbox."
          size="sm"
        >
          <CaptureForm
            rootProjectId={rootProjectId}
            variant="mobile"
            autoFocus
            onSuccess={close}
            onCancel={close}
          />
        </Dialog>
      ) : null}
    </>
  );
}
