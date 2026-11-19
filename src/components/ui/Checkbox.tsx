import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
  invalid?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, invalid = false, className, id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  return (
    <div className={cn(styles.wrapper, className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className={styles.input}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      <label htmlFor={inputId} className={styles.label}>
        <span className={styles.text}>{label}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </label>
    </div>
  );
});
