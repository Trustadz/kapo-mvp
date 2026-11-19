import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'brand' | 'warning' | 'success' | 'archived' | 'pulled' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

/** Small status label; archived rows also use dashed borders + muted text. */
export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return <span className={cn(styles.badge, styles[tone], className)}>{children}</span>;
}
