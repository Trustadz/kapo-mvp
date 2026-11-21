'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import styles from './Tabs.module.css';

/**
 * Accessible tab strip (WAI-ARIA tabs pattern, automatic activation).
 *
 * The caller renders the matching `tabpanel` elements; use
 * {@link tabId} / {@link tabPanelId} so `aria-controls` and `aria-labelledby`
 * stay paired. Arrow keys move and activate, Home/End jump to the first/last
 * tab, and only the selected tab is in the document tab order.
 */

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  /** Optional unsaved-changes marker (decorative; the panel states it in words). */
  dirty?: boolean;
}

export interface TabsProps<T extends string = string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  /** Prefix shared with the panel ids. Defaults to `tabs`. */
  idPrefix?: string;
  className?: string;
}

export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

export function tabPanelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}

export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  idPrefix = 'tabs',
  className,
}: TabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentIndex = items.findIndex((item) => item.id === value);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (items.length === 0) return;
    const index = currentIndex >= 0 ? currentIndex : 0;
    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % items.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }
    const next = items[nextIndex];
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn(styles.tablist, className)}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, item.id)}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            data-active={selected || undefined}
            data-dirty={item.dirty || undefined}
            onClick={() => onChange(item.id)}
            onKeyDown={handleKeyDown}
          >
            <span>{item.label}</span>
            {item.dirty ? (
              <span className={styles.dirty} aria-hidden="true" data-tab-dirty="" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
