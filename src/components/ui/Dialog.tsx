'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** When false, Escape/backdrop do not close (e.g. while a save is running). */
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Modal dialog built on the native <dialog> element, so focus trapping,
 * Escape handling and the inert background come from the platform.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  size = 'md',
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      if (open) onClose();
    };
    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (dismissible) onClose();
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [open, onClose, dismissible]);

  return (
    <dialog
      ref={dialogRef}
      className={cn(styles.dialog, styles[size], className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div className={styles.surface}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close dialog"
            disabled={!dismissible}
          >
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </dialog>
  );
}
