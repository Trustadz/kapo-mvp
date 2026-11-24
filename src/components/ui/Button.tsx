import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'quiet' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Replaces the label while `loading`, e.g. “Saving…”. */
  loadingLabel?: ReactNode;
  icon?: ReactNode;
  fullWidth?: boolean;
}

/**
 * Button — 40px tall (build-spec §8).
 *
 * primary: filled brand (the main action per screen)
 * quiet:   brandLight fill (Cancel, secondary inline actions)
 * ghost:   text/icon only (toolbar actions)
 * danger:  destructive confirmation
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  icon,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        styles.button,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.label}>
        {loading && loadingLabel ? loadingLabel : children}
      </span>
    </button>
  );
}

export interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
  prefetch?: boolean;
  target?: string;
  rel?: string;
}

/** Next.js Link styled as a button for navigation actions. */
export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth = false,
  className,
  children,
  prefetch,
  target,
  rel,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      target={target}
      rel={rel}
      className={cn(
        styles.button,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        styles.link,
        className,
      )}
    >
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.label}>{children}</span>
    </Link>
  );
}
