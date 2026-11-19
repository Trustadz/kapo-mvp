import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import styles from './Input.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** Text input — 42px tall, radius 8, border token (build-spec §8). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(styles.input, invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
