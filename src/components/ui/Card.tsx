import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Defaults to a plain div; section/article give documents better landmarks. */
  as?: 'div' | 'section' | 'article' | 'aside';
  padded?: boolean;
}

/** White surface, 1px border, radius 12, no shadow (build-spec §3). */
export function Card({ as: Tag = 'div', padded = true, className, children, ...rest }: CardProps) {
  return (
    <Tag className={cn(styles.card, padded && styles.padded, className)} {...rest}>
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
}

export function CardHeader({ title, description, action, level = 2 }: CardHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.header}>
      <div className={styles.headerText}>
        <Heading className={styles.title}>{title}</Heading>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {action ? <div className={styles.headerAction}>{action}</div> : null}
    </div>
  );
}
