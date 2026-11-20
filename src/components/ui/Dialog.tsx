'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n/client';
import styles from './Dialog.module.css';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Tab-ordered controls inside a dialog. `offsetParent` filters out
 * `display: none` controls (dialog bodies can render loading/empty states in
 * place of the form); the active element is kept so focus cannot be lost when
 * the last control is removed while it still has focus.
 */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

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
  /**
   * Optional element to focus after the native dialog opens. Native <dialog>
   * focus handling focuses the first control (the close button) in some
   * browsers, and React's autoFocus is not reliable there (notably Firefox).
   * Only dialogs that explicitly pass a ref get this behaviour.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
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
  initialFocusRef,
}: DialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  /** Element that opened the dialog; focus returns here when it closes. */
  const openerRef = useRef<HTMLElement | null>(null);
  /** True between showModal() and close(); read by the unmount cleanup. */
  const wasOpenRef = useRef(false);

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current;
    if (opener && opener.isConnected) {
      opener.focus();
      return;
    }
    // The opener may have been removed (e.g. a Kanban card after a refresh).
    // Never leave focus behind a closed dialog: fall back to the content.
    const main = document.getElementById('main-content');
    if (main) {
      main.focus();
      return;
    }
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Capture the opener before showModal() runs the platform focus steps.
      openerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      wasOpenRef.current = true;
      // Native <dialog> focuses the first focusable element (usually the close
      // button). Prefer an explicit ref, then the first control in the dialog
      // body so form dialogs open on their first field.
      const body = dialog.querySelector<HTMLElement>('[data-dialog-body]');
      const target =
        initialFocusRef?.current ??
        (body ? focusableIn(body)[0] : undefined) ??
        focusableIn(dialog)[0] ??
        dialog;
      // showModal() runs the platform's own focus steps first; move focus on
      // the next frame so this wins consistently across browsers.
      const frame = requestAnimationFrame(() => target.focus());
      return () => cancelAnimationFrame(frame);
    } else if (!open && dialog.open) {
      dialog.close();
      wasOpenRef.current = false;
      // Native close() restores focus in most browsers. Run after it so a
      // missing/removed opener still lands somewhere sensible.
      const frame = requestAnimationFrame(restoreFocus);
      return () => cancelAnimationFrame(frame);
    }
  }, [open, initialFocusRef, restoreFocus]);

  // Explicit focus trap. Modal <dialog> makes the rest of the page inert, but
  // Chromium still lets Tab move focus out of the dialog (to the browser UI or
  // the document body), so wrap Tab/Shift+Tab inside the dialog.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = focusableIn(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open]);

  // Dialogs are often mounted only while open (ProjectView renders them
  // conditionally). In that case React removes the element without the close
  // effect above ever running, so restore focus from the unmount cleanup.
  useEffect(
    () => () => {
      if (!wasOpenRef.current) return;
      wasOpenRef.current = false;
      const dialog = dialogRef.current;
      const active = document.activeElement;
      const focusWasInside = dialog !== null && active !== null && dialog.contains(active);
      if (focusWasInside || active === null || active === document.body) {
        restoreFocus();
      }
    },
    [restoreFocus],
  );

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
      tabIndex={-1}
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
            aria-label={t('common.closeDialog')}
            disabled={!dismissible}
          >
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className={styles.body} data-dialog-body="">
          {children}
        </div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </dialog>
  );
}
