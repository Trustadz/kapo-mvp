'use client';

import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import styles from './Field.module.css';

/**
 * Props the shared Field writes onto its single control child. Cloning keeps
 * the label/hint/error association in one place instead of asking every form
 * to re-declare `aria-describedby` and `aria-invalid` (issue #33).
 */
interface ControlProps {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}

function joinIds(...ids: Array<string | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(' ');
  return value.length > 0 ? value : undefined;
}

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
 * (build-spec §8). The hint and error are associated with the control through
 * `aria-describedby`; errors are announced with role="alert" and the required
 * state is exposed on the control itself.
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
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;
  const errorId = `${generatedId}-error`;

  let control = children;
  if (isValidElement(children)) {
    const element = children as ReactElement<ControlProps>;
    const existing = element.props['aria-describedby'];
    control = cloneElement(element, {
      'aria-describedby': joinIds(existing, hint ? hintId : undefined, error ? errorId : undefined),
      ...(error ? { 'aria-invalid': true } : {}),
      ...(required ? { required: true } : {}),
    });
  }

  return (
    <div
      className={cn(styles.field, error && styles.hasError, changed && 'changed-field', className)}
      data-changed={changed || undefined}
      style={labelWidth ? { ['--field-label-width' as string]: `${labelWidth}px` } : undefined}
    >
      <label className={cn(styles.label, required && styles.required)} htmlFor={htmlFor}>
        {label}
      </label>
      <div className={styles.control}>
        {control}
        {hint ? (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className={styles.error} role="alert">
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
  /** Session-scoped "changed in this visit" emphasis (issue #56). */
  changed?: boolean;
  className?: string;
  /** Optional class for the inner control column (radio/check lists). */
  controlClassName?: string;
  children: ReactNode;
}

/**
 * Fieldset variant for radio/checkbox groups. The semantic legend names the
 * group; the visually hidden legend plus aria-hidden visible label keep the
 * desktop label-beside-control rhythm without duplicating the announcement.
 */
export function FieldGroup({
  legend,
  hint,
  error,
  changed = false,
  className,
  controlClassName,
  children,
}: FieldGroupProps) {
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;
  const errorId = `${generatedId}-error`;
  const describedBy = joinIds(hint ? hintId : undefined, error ? errorId : undefined);

  return (
    <fieldset
      className={cn(styles.fieldsetRoot, changed && 'changed-field', className)}
      data-changed={changed || undefined}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
    >
      <legend className="visually-hidden">{legend}</legend>
      <div className={styles.field}>
        <span className={styles.label} aria-hidden="true">
          {legend}
        </span>
        <div className={cn(styles.control, controlClassName)}>
          {children}
          {hint ? (
            <p id={hintId} className={styles.hint}>
              {hint}
            </p>
          ) : null}
          {error ? (
            <p id={errorId} className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}
