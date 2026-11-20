import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './Field.module.css';

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Optional fixed label column width on desktop (defaults to 180px). */
  labelWidth?: number;
  /** Session-scoped "changed in this visit" emphasis (issue #56). */
  changed?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Form field: label beside the control on desktop, above it on mobile
 * (build-spec §8). Errors are announced with role="alert".
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  labelWidth,
  changed = false,
  className,
  children,
}: FieldProps) {
  return (
    <div
      className={cn(styles.field, error && styles.hasError, changed && 'changed-field', className)}
      data-changed={changed || undefined}
      style={labelWidth ? { ['--field-label-width' as string]: `${labelWidth}px` } : undefined}
    >
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <div className={styles.control}>
        {children}
        {hint ? <p className={styles.hint}>{hint}</p> : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface FieldGroupProps {
  legend: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

/** Fieldset variant for radio/checkbox groups. */
export function FieldGroup({ legend, hint, error, className, children }: FieldGroupProps) {
  return (
    <fieldset className={cn(styles.fieldsetRoot, className)}>
      {/* The legend names the group for assistive technology; the visible
       * label below keeps the desktop label-beside-control rhythm. */}
      <legend className="visually-hidden">{legend}</legend>
      <div className={styles.field}>
        <span className={styles.label} aria-hidden="true">
          {legend}
        </span>
        <div className={styles.control}>
          {children}
          {hint ? <p className={styles.hint}>{hint}</p> : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}
