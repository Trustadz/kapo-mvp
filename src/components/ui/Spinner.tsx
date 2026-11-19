export interface SpinnerProps {
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}

/** CSS-only loading indicator; respects prefers-reduced-motion. */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span
      className={['spinner', `spinner-${size}`, className].filter(Boolean).join(' ')}
      role={label ? 'status' : undefined}
      aria-label={label}
    >
      <span className="spinner-ring" aria-hidden="true" />
      {label ? <span className="visually-hidden">{label}</span> : null}
    </span>
  );
}
