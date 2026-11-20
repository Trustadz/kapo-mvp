'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import type { AuthUser, FavoriteProject } from '@/lib/types';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n/client';
import { AccountMenu } from './AccountMenu';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  user: AuthUser;
  favorites: FavoriteProject[];
  rootProjectId: string | null;
  collapsed: boolean;
  onToggle: () => void;
}

interface SidebarLinkProps {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({ href, icon, label, active }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      className={cn(styles.navItem, active && styles.active)}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      data-tooltip={label}
    >
      <Icon name={icon} size={20} />
      <span className={styles.navLabel}>{label}</span>
    </Link>
  );
}

/**
 * Desktop navigation: 244px expanded / 72px collapsed with tooltips and
 * accessible labels (build-spec §8; product.md §2).
 */
export function Sidebar({ user, favorites, rootProjectId, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <aside className={styles.sidebar} aria-label={t('shell.sidebar')} data-collapsed={collapsed || undefined}>
      <div className={styles.brandRow}>
        <Link href="/" className={styles.brand} aria-label={t('shell.kapoHome')}>
          <span className={styles.logoPlate}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={28} height={28} className={styles.logo} />
          </span>
          <span className={styles.wordmark}>kapo</span>
        </Link>
      </div>

      <nav className={styles.nav} aria-label={t('shell.mainNavigation')}>
        <SidebarLink href="/" icon="home" label={t('common.home')} active={pathname === '/'} />
        {rootProjectId ? (
          <SidebarLink
            href={`/p/${rootProjectId}`}
            icon="account_tree"
            label={t('common.root')}
            active={isActivePath(pathname, `/p/${rootProjectId}`)}
          />
        ) : null}
        <SidebarLink href="/inbox" icon="inbox" label={t('common.inbox')} active={isActivePath(pathname, '/inbox')} />
        <SidebarLink href="/search" icon="search" label={t('common.search')} active={isActivePath(pathname, '/search')} />
      </nav>

      {favorites.length > 0 ? (
        <>
          <div className={styles.divider} />
          <section className={styles.favorites} aria-labelledby="favorites-heading">
            <h2 id="favorites-heading" className={styles.sectionLabel}>
              {t('common.favorites')}
            </h2>
            <ul className={styles.favoriteList}>
              {favorites.map((favorite) => (
                <li key={favorite.id}>
                  <SidebarLink
                    href={`/p/${favorite.id}`}
                    icon="folder"
                    label={favorite.title}
                    active={isActivePath(pathname, `/p/${favorite.id}`)}
                  />
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.collapseButton}
          onClick={onToggle}
          aria-pressed={collapsed}
          aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          data-tooltip={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
        >
          <Icon name={collapsed ? 'left_panel_open' : 'left_panel_close'} size={20} />
          <span className={styles.collapseLabel}>
            {collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          </span>
        </button>
        <div className={styles.account}>
          <AccountMenu
            user={user}
            variant={collapsed ? 'compact' : 'sidebar'}
            side="top"
            align="start"
            className={collapsed ? styles.compactAccount : undefined}
          />
        </div>
      </div>
    </aside>
  );
}
