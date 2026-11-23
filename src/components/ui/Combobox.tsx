'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import styles from './Combobox.module.css';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  /**
   * Avatar image (or null for initials). The presence of this property opts
   * the option into avatar rendering; omit it for ordinary text options.
   */
  avatar?: string | null;
  /** Optional leading Material Symbols icon when no avatar is needed. */
  icon?: string;
}

export interface ComboboxProps {
  id?: string;
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the trigger (for example "Assign Assigned to"). */
  label: string;
  searchLabel: string;
  listLabel: string;
  /** Shown when the current value has no matching option. */
  placeholder?: string;
  /** Shown when the search has no matches. */
  emptyLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  error?: string;
  className?: string;
  align?: 'start' | 'end';
}

function OptionLeading({ option }: { option: ComboboxOption }) {
  if (option.avatar !== undefined) {
    return <Avatar name={option.label} src={option.avatar ?? undefined} size={24} decorative />;
  }
  if (option.icon) {
    return (
      <span className={styles.iconLeading} aria-hidden="true">
        <Icon name={option.icon} size={16} />
      </span>
    );
  }
  return null;
}

/**
 * Generic searchable single-select.
 *
 * Keyboard: the trigger opens the list with Enter, Space or ArrowDown; the
 * search field supports ArrowUp/ArrowDown, Home/End, Enter to choose and
 * Escape to close (focus returns to the trigger). Options may render a leading
 * avatar (user pickers) or icon, plus an optional description line.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  label,
  searchLabel,
  listLabel,
  placeholder,
  emptyLabel,
  disabled = false,
  invalid = false,
  error,
  className,
  align = 'end',
}: ComboboxProps) {
  const generatedId = useId();
  const baseId = id ?? `combobox-${generatedId.replace(/:/g, '')}`;
  const listId = `${baseId}-list`;
  const errorId = `${baseId}-error`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(normalizedQuery),
  );

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointer);
    return () => document.removeEventListener('pointerdown', handlePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const choose = (next: string) => {
    setOpen(false);
    if (next !== value) onChange(next);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className={cn(styles.root, className)} ref={rootRef} onKeyDown={handleRootKeyDown}>
      <button
        ref={triggerRef}
        id={baseId}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={styles.value}>
          {selected ? (
            <>
              <OptionLeading option={selected} />
              <span className={styles.valueText}>{selected.label}</span>
            </>
          ) : (
            <span className={styles.placeholder}>{placeholder ?? ''}</span>
          )}
        </span>
        <Icon name="expand_more" size={18} className={styles.chevron} />
      </button>

      {open ? (
        <div className={cn(styles.popover, align === 'start' ? styles.alignStart : styles.alignEnd)}>
          <div className={styles.searchRow}>
            <Icon name="search" size={18} />
            <input
              ref={inputRef}
              className={styles.search}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                filtered[active] ? `${listId}-option-${active}` : undefined
              }
              aria-label={searchLabel}
              placeholder={searchLabel}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  setActive(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  setActive(Math.max(filtered.length - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const option = filtered[active];
                  if (option) choose(option.value);
                }
              }}
            />
          </div>
          <ul id={listId} className={styles.list} role="listbox" aria-label={listLabel}>
            {filtered.length === 0 ? (
              <li className={styles.empty} role="presentation">
                {emptyLabel ?? ''}
              </li>
            ) : (
              filtered.map((option, index) => (
                <li key={option.value || 'empty'} role="presentation">
                  <button
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    id={`${listId}-option-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={option.value === value}
                    className={styles.option}
                    data-active={index === active || undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option.value)}
                  >
                    <OptionLeading option={option} />
                    <span className={styles.optionText}>
                      <span className={styles.optionLabel}>{option.label}</span>
                      {option.description ? (
                        <span className={styles.optionDescription}>{option.description}</span>
                      ) : null}
                    </span>
                    {option.value === value ? (
                      <Icon name="check" size={18} className={styles.check} />
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
