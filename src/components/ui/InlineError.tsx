import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';
import styles from './InlineError.module.css';

export interface InlineErrorProps {
  children: ReactNode;
  id?: string;
  className?: string;
}

/** Single-line field/form error, announced to assistive technology. */
export function InlineError({ children, id, className }: InlineErrorProps) {
  return (
    <p id={id} className={cn(styles.error, className)} role="alert">
      <Icon name="error" size={16} />
      <span>{children}</span>
    </p>
  );
}
