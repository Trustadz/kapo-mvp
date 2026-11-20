import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import styles from './AuthShell.module.css';

export interface AuthShellProps {
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Centered first-run / sign-in composition from the Penpot account screens:
 * the light lockup above a single 558px card on the canvas background.
 */
export function AuthShell({ children, footer }: AuthShellProps) {
  return (
    <main className={styles.page}>
      <div className={styles.lockup}>
        <span className={styles.logoPlate}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={32} height={32} className={styles.logo} />
        </span>
        <span className={styles.wordmark}>kapo</span>
      </div>
      <div className={styles.card}>
        {children}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
      <div className={styles.languageRow}>
        <LanguageSwitcher id="auth-language" />
      </div>
    </main>
  );
}
