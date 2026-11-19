'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { AuthUser } from '@/lib/types';
import { AccountMenu } from './AccountMenu';
import { CaptureForm } from './CaptureForm';
import styles from './TopBar.module.css';

export interface TopBarProps {
  user: AuthUser;
  rootProjectId: string | null;
}

/**
 * 64px top bar with global capture and Search (desktop), plus the compact
 * mobile header with search and the account avatar (build-spec §8).
 */
export function TopBar({ user, rootProjectId }: TopBarProps) {
  return (
    <>
      <header className={styles.desktopBar}>
        <div className={styles.capture}>
          <CaptureForm rootProjectId={rootProjectId} />
        </div>
        <Link href="/search" className={styles.searchLink}>
          <Icon name="search" size={20} />
          <span>Search</span>
        </Link>
      </header>

      <header className={styles.mobileBar}>
        <Link href="/" className={styles.mobileBrand} aria-label="Kapo — Home">
          <span className={styles.logoPlate}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={24} height={24} className={styles.logo} />
          </span>
          <span className={styles.wordmark}>kapo</span>
        </Link>
        <div className={styles.mobileActions}>
          <Link href="/search" className={styles.mobileIconButton} aria-label="Search">
            <Icon name="search" size={22} />
          </Link>
          <AccountMenu user={user} variant="compact" side="bottom" align="end" />
        </div>
      </header>
    </>
  );
}
