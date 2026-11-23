'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { LiveRegion } from '@/components/ui/LiveRegion';
import { useAnnouncer } from '@/components/ui/use-live-announcer';
import { Menu, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { FavoriteProject } from '@/lib/types';
import { CaptureForm } from './CaptureForm';
import { useI18n } from '@/i18n/client';
import styles from './MobileNav.module.css';

export interface MobileNavProps {
  rootProjectId: string | null;
  favorites: FavoriteProject[];
  /** Application Viewers are read-only; the Add capture action is hidden. */
  canCapture: boolean;
}

/** Menu items for the mobile Favorites pop-over. */
export function favoriteMenuItems(favorites: FavoriteProject[]): MenuItem[] {
  return favorites.map((favorite) => ({
    id: favorite.id,
    label: favorite.title,
    icon: 'star',
    href: `/p/${favorite.id}`,
  }));
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Mobile bottom bar: Home / Root / Add / Inbox / Favorites (build-spec §8). */
export function MobileNav({ rootProjectId, favorites, canCapture }: MobileNavProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);
  const { announcement, announce } = useAnnouncer();

  const close = () => setAddOpen(false);
  const favoriteProjectActive = favorites.some((favorite) =>
    isActive(pathname, `/p/${favorite.id}`),
  );
  const favoritesActive = favoriteProjectActive;
  const favoriteItems = favoriteMenuItems(favorites);
  const favoritesHeader = (
    <div className={styles.favoritesMenuHeader}>
      <span className={styles.favoritesMenuTitle}>{t('common.favorites')}</span>
    </div>
  );

  return (
    <>
      <nav className={styles.bar} aria-label={t('shell.mobileNavigation')}>
        <Link
          href="/"
          className={cn(styles.tab, pathname === '/' && styles.active)}
          aria-current={pathname === '/' ? 'page' : undefined}
        >
          <Icon name="home" size={22} />
          <span className={styles.label}>{t('common.home')}</span>
        </Link>
        {rootProjectId ? (
          <Link
            href={`/p/${rootProjectId}`}
            className={cn(styles.tab, isActive(pathname, `/p/${rootProjectId}`) && styles.active)}
            aria-current={isActive(pathname, `/p/${rootProjectId}`) ? 'page' : undefined}
          >
            <Icon name="account_tree" size={22} />
            <span className={styles.label}>{t('common.root')}</span>
          </Link>
        ) : null}
        {canCapture ? (
          <button
            type="button"
            className={cn(styles.tab, styles.addTab)}
            onClick={() => setAddOpen(true)}
            aria-label={t('shell.captureForm')}
            aria-haspopup="dialog"
          >
            <Icon name="add" size={24} />
            <span className={styles.label}>{t('shell.add')}</span>
          </button>
        ) : null}
        <Link
          href="/inbox"
          className={cn(styles.tab, isActive(pathname, '/inbox') && styles.active)}
          aria-current={isActive(pathname, '/inbox') ? 'page' : undefined}
        >
          <Icon name="inbox" size={22} />
          <span className={styles.label}>{t('common.inbox')}</span>
        </Link>
        <Menu
          className={styles.favoritesMenu}
          label={t('common.favorites')}
          align="end"
          side="top"
          header={favoritesHeader}
          items={favoriteItems}
          trigger={({ ref, ...triggerProps }) => (
            <button
              {...triggerProps}
              ref={ref}
              type="button"
              className={cn(
                styles.tab,
                styles.favoritesTab,
                favoritesActive && styles.active,
              )}
            >
              <Icon name="star" size={22} filled={favoritesActive} />
              <span className={styles.label}>{t('common.favorites')}</span>
            </button>
          )}
        />
      </nav>


      {canCapture ? (
        <Dialog
          open={addOpen}
          onClose={close}
          title={t('shell.addProjectTitle')}
          size="sm"
        >
          <CaptureForm
            rootProjectId={rootProjectId}
            variant="mobile"
            autoFocus
            announceSuccess={false}
            onSuccess={(title) => {
              // The dialog unmounts on success, so announce from the shell that
              // stays mounted instead of the form's own live region.
              announce(t('shell.captureSuccess', { title }));
              close();
            }}
            onCancel={close}
          />
        </Dialog>
      ) : null}
      <LiveRegion message={announcement.message} sequence={announcement.sequence} />
    </>
  );
}
