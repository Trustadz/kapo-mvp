'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { AuthUser } from '@/lib/types';
import { AccountMenu } from './AccountMenu';
import { CaptureForm } from './CaptureForm';
import { useI18n } from '@/i18n/client';
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
  const { t } = useI18n();
  const canCapture = user.appRole !== 'viewer';

  return (
    <>
      <header className={styles.desktopBar}>
        <div className={styles.capture}>
          {canCapture ? (
            <CaptureForm rootProjectId={rootProjectId} />
          ) : (
            <p className={styles.readOnlyHint}>
              <Icon name="visibility" size={18} />
              <span>{t('shell.viewersCanBrowseOnly')}</span>
            </p>
          )}
        </div>
        <Link href="/search" className={styles.searchLink}>
          <Icon name="search" size={20} />
          <span>{t('common.search')}</span>
        </Link>
      </header>

      <header className={styles.mobileBar}>
        <Link href="/" className={styles.mobileBrand} aria-label={t('shell.kapoHome')}>
          <span className={styles.logoPlate}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={24} height={24} className={styles.logo} />
          </span>
          <span className={styles.wordmark}>kapo</span>
        </Link>
        <div className={styles.mobileActions}>
          <Link href="/search" className={styles.mobileIconButton} aria-label={t('common.search')}>
            <Icon name="search" size={22} />
          </Link>
          <AccountMenu user={user} variant="compact" side="bottom" align="end" />
        </div>
      </header>
    </>
  );
}
