import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';
import styles from './Notice.module.css';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

const TONE_ICONS: Record<NoticeTone, string> = {
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  error: 'error',
};

/**
 * Inline feedback block. Local form errors use error tone with role="alert";
 * success/status feedback uses role="status".
 */
export function Notice({ tone = 'info', title, children, className }: NoticeProps) {
  return (
    <div
      className={cn(styles.notice, styles[tone], className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon name={TONE_ICONS[tone]} size={20} className={styles.icon} />
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
