import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import styles from './Radio.module.css';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, description, className, id, ...rest },
  ref,
) {
  const inputId = id ?? `${rest.name ?? 'radio'}-${String(rest.value ?? '')}`;
  return (
    <div className={cn(styles.wrapper, className)}>
      <input ref={ref} id={inputId} type="radio" className={styles.input} {...rest} />
      <label htmlFor={inputId} className={styles.label}>
        <span>{label}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </label>
    </div>
  );
});
