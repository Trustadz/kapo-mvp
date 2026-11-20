'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { computeMenuPosition, type MenuPosition } from '@/lib/menu-position';
import { Icon } from './Icon';
import styles from './Menu.module.css';

/**
 * `useLayoutEffect` warns during server rendering. The menu is only ever open
 * after a client interaction, but the component itself is still pre-rendered.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function viewportSize(): { width: number; height: number } {
  const root = document.documentElement;
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
}

export interface MenuActionItem {
  id: string;
  label: string;
  icon?: string;
  href?: string;
  onSelect?: () => void;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuSubmenuItem {
  id: string;
  label: string;
  icon?: string;
  items: MenuActionItem[];
}

export interface MenuSeparator {
  id: string;
  separator: true;
}

export type MenuItem = MenuActionItem | MenuSubmenuItem | MenuSeparator;

export interface MenuTriggerProps {
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-haspopup': 'menu';
  'aria-controls': string;
  id: string;
  ref: (node: HTMLButtonElement | null) => void;
}

export interface MenuProps {
  /** Render prop so the trigger keeps its own visual identity. */
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: MenuItem[];
  label: string;
  /** Optional identity/header block rendered above the items. */
  header?: ReactNode;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  className?: string;
}

function isSubmenu(item: MenuItem): item is MenuSubmenuItem {
  return !('separator' in item) && 'items' in item;
}

function isSeparator(item: MenuItem): item is MenuSeparator {
  return 'separator' in item;
}

/**
 * Keyboard-operable disclosure menu (WAI-ARIA menu pattern).
 *
 * Escape closes and returns focus to the trigger; arrow keys move between
 * items; submenus open with Enter/Space/ArrowRight or pointer hover.
 */
export function Menu({
  trigger,
  items,
  label,
  header,
  align = 'start',
  side = 'bottom',
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const generatedId = useId();
  const panelId = `kapo-menu-${generatedId.replace(/[^a-zA-Z0-9-]/g, '')}`;
  const triggerId = `${panelId}-trigger`;

  const close = useCallback(() => {
    setOpen(false);
    setOpenSubmenu(null);
    setPosition(null);
    triggerRef.current?.focus();
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    const root = rootRef.current;
    if (!trigger || !panel || !root) return;
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const next = computeMenuPosition(
      triggerRect,
      { width: panelRect.width, height: panelRect.height },
      viewportSize(),
      { align, side },
    );
    // Absolute panels are positioned inside the root's padding box; fixed
    // panels use the viewport coordinates directly.
    const rootRect = root.getBoundingClientRect();
    const resolved = {
      top: next.top - (rootRect.top + root.clientTop),
      left: next.left - (rootRect.left + root.clientLeft),
    };
    setPosition((current) =>
      current && current.top === resolved.top && current.left === resolved.left
        ? current
        : resolved,
    );
  }, [align, side]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    // Measure synchronously after the panel mounts so it paints in place.
    updatePosition();

    let frame = 0;
    const scheduleUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updatePosition();
      });
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);

    window.addEventListener('resize', scheduleUpdate);
    // Capture scroll events from nested scroll containers such as Kanban.
    window.addEventListener('scroll', scheduleUpdate, true);
    if (observer && panelRef.current) observer.observe(panelRef.current);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      observer?.disconnect();
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) setPosition(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setOpenSubmenu(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        '[data-menu-item="true"]:not([disabled])',
      );
      first?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowRight') {
      const submenuTrigger = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-submenu-trigger="true"]',
      );
      if (submenuTrigger?.dataset.submenuId) {
        event.preventDefault();
        setOpenSubmenu(submenuTrigger.dataset.submenuId);
      }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const focusable = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-menu-item="true"]:not([disabled])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    event.preventDefault();
    const active = document.activeElement;
    const index = focusable.findIndex((element) => element === active);
    const nextIndex =
      event.key === 'ArrowDown'
        ? index < 0
          ? 0
          : (index + 1) % focusable.length
        : index <= 0
          ? focusable.length - 1
          : index - 1;
    focusable[nextIndex]?.focus();
  };

  const activate = (item: MenuActionItem) => {
    if (item.disabled) return;
    if (item.onSelect) item.onSelect();
    if (!item.href) close();
    else setOpen(false);
  };

  const renderAction = (item: MenuActionItem, inSubmenu: boolean) => {
    const content = (
      <>
        {item.icon ? <Icon name={item.icon} size={18} className={styles.itemIcon} /> : null}
        <span className={styles.itemLabel}>{item.label}</span>
        {item.selected ? <Icon name="check" size={18} className={styles.itemCheck} /> : null}
      </>
    );
    const role = item.selected === undefined ? 'menuitem' : 'menuitemradio';
    const className = cn(styles.item, item.danger && styles.danger, inSubmenu && styles.submenuItem);

    if (item.href && !item.disabled) {
      return (
        <Link
          key={item.id}
          href={item.href}
          role={role}
          className={className}
          data-menu-item="true"
          aria-checked={role === 'menuitemradio' ? item.selected === true : undefined}
          onClick={() => setOpen(false)}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        key={item.id}
        type="button"
        role={role}
        className={className}
        data-menu-item="true"
        aria-checked={role === 'menuitemradio' ? item.selected === true : undefined}
        disabled={item.disabled}
        onClick={() => activate(item)}
      >
        {content}
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      className={cn(styles.root, className)}
      data-open={open || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !open) return;
      }}
    >
      {trigger({
        onClick: () => {
          if (open) {
            setOpen(false);
            setOpenSubmenu(null);
          } else {
            setPosition(null);
            setOpen(true);
          }
        },
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        'aria-controls': panelId,
        id: triggerId,
        ref: (node) => {
          triggerRef.current = node;
        },
      })}

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label={label}
          className={cn(styles.panel)}
          style={position ? { top: position.top, left: position.left } : undefined}
          onKeyDown={handlePanelKeyDown}
        >
          {header ? <div className={styles.menuHeader}>{header}</div> : null}
          {items.map((item) => {
            if (isSeparator(item)) {
              return <div key={item.id} role="separator" className={styles.separator} />;
            }
            if (isSubmenu(item)) {
              const expanded = openSubmenu === item.id;
              return (
                <div key={item.id} className={styles.submenuRoot}>
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={expanded}
                    className={styles.item}
                    data-menu-item="true"
                    data-submenu-trigger="true"
                    data-submenu-id={item.id}
                    onClick={() => setOpenSubmenu(expanded ? null : item.id)}
                    onMouseEnter={() => setOpenSubmenu(item.id)}
                  >
                    {item.icon ? <Icon name={item.icon} size={18} className={styles.itemIcon} /> : null}
                    <span className={styles.itemLabel}>{item.label}</span>
                    <Icon name="chevron_right" size={18} className={styles.itemChevron} />
                  </button>
                  {expanded ? (
                    <div role="menu" aria-label={item.label} className={styles.submenuPanel}>
                      {item.items.map((child) => renderAction(child, true))}
                    </div>
                  ) : null}
                </div>
              );
            }
            return renderAction(item, false);
          })}
        </div>
      ) : null}
    </div>
  );
}
