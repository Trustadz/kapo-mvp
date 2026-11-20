'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
  invalid?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, invalid = false, className, id, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? rest.name ?? `checkbox-${generatedId}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const mergedDescribedBy = [describedBy, descriptionId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn(styles.wrapper, className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className={styles.input}
        aria-invalid={invalid || undefined}
        aria-describedby={mergedDescribedBy}
        {...rest}
      />
      <label htmlFor={inputId} className={styles.label}>
        <span className={styles.text}>{label}</span>
        {description ? (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
});
