import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Short and actionable empty state (build-spec §8). */
export function EmptyState({ icon = 'inbox', title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn(styles.empty, className)}>
      <Icon name={icon} size={32} className={styles.icon} />
      <h2 className={styles.title}>{title}</h2>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
