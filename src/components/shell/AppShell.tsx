'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { AuthUser, FavoriteProject } from '@/lib/types';
import { MobileNav } from './MobileNav';
import { ServiceWorkerRegister } from './ServiceWorkerRegister';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import styles from './AppShell.module.css';

export interface AppShellProps {
  user: AuthUser;
  favorites: FavoriteProject[];
  rootProjectId: string | null;
  installationName: string;
  children: ReactNode;
}

const SIDEBAR_STORAGE_KEY = 'kapo-sidebar-collapsed';

/**
 * Authenticated application shell. The server layout supplies serialisable
 * user/favorites data; everything interactive (collapse, capture, menus) is
 * client-side.
 */
export function AppShell({ user, favorites, rootProjectId, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');
    } catch {
      /* ignore unavailable storage */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className={cn('app-shell', styles.shell)}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        user={user}
        favorites={favorites}
        rootProjectId={rootProjectId}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />
      <div className="app-main">
        <TopBar user={user} rootProjectId={rootProjectId} />
        <main id="main-content" className="app-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <MobileNav rootProjectId={rootProjectId} canCapture={user.appRole !== 'viewer'} />
      <ServiceWorkerRegister />
    </div>
  );
}
