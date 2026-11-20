'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './Radio.module.css';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, description, className, id, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId =
    id ?? (rest.name ? `${rest.name}-${String(rest.value ?? '')}` : `radio-${generatedId}`);
  const descriptionId = description ? `${inputId}-description` : undefined;
  const mergedDescribedBy = [describedBy, descriptionId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn(styles.wrapper, className)}>
      <input
        ref={ref}
        id={inputId}
        type="radio"
        className={styles.input}
        aria-describedby={mergedDescribedBy}
        {...rest}
      />
      <label htmlFor={inputId} className={styles.label}>
        <span>{label}</span>
        {description ? (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
});
