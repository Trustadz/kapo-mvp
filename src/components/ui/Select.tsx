import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';
import styles from './Select.module.css';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Native select (keyboard + mobile friendly) with the design's trailing chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className, children, ...rest },
  ref,
) {
  return (
    <span className={cn(styles.wrapper, className)}>
      <select
        ref={ref}
        className={cn(styles.select, invalid && styles.invalid)}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <Icon name="expand_more" size={20} className={styles.chevron} />
    </span>
  );
});
