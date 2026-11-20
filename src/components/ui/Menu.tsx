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

/** Enabled, visible items belonging directly to `menu` (not a nested panel). */
function menuItemsIn(menu: HTMLElement): HTMLElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[data-menu-item="true"]:not([disabled])'),
  ).filter(
    (element) =>
      element.offsetParent !== null &&
      element.closest<HTMLElement>('[role="menu"]') === menu,
  );
}

/** Document tab order, excluding the open menu panel and its submenus. */
function tabbablesOutside(panel: HTMLElement | null): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.offsetParent !== null &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !(panel?.contains(element) ?? false),
  );
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
  /**
   * Position the panel against the viewport instead of the menu root. This
   * lets a menu escape a clipping scroll container (e.g. the Kanban grid).
   */
  fixed?: boolean;
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
  fixed = false,
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** Which panel edge gets focus after the next open ('first' by default). */
  const pendingOpenFocusRef = useRef<'first' | 'last'>('first');
  /** Set when a submenu should take focus once it mounts (keyboard paths). */
  const pendingSubmenuFocusRef = useRef(false);
  const generatedId = useId();
  const panelId = `kapo-menu-${generatedId.replace(/[^a-zA-Z0-9-]/g, '')}`;
  const triggerId = `${panelId}-trigger`;

  const close = useCallback(() => {
    setOpen(false);
    setOpenSubmenu(null);
    setPosition(null);
    triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback((focus: 'first' | 'last' = 'first') => {
    pendingOpenFocusRef.current = focus;
    setPosition(null);
    setOpen(true);
  }, []);

  /** Open a submenu and move focus to its first item after it renders. */
  const openSubmenuWithFocus = useCallback((submenuId: string) => {
    pendingSubmenuFocusRef.current = true;
    setOpenSubmenu(submenuId);
  }, []);

  const focusSubmenuTrigger = useCallback((submenuId: string) => {
    setOpenSubmenu(null);
    const trigger = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[data-submenu-trigger="true"]') ?? [],
    ).find((element) => element.dataset.submenuId === submenuId);
    trigger?.focus();
  }, []);

  /**
   * Tab closes a non-modal menu and continues the document tab order after the
   * trigger, so focus is never left on a removed item.
   */
  const closeAndMoveFocusOut = useCallback(
    (direction: 1 | -1) => {
      const trigger = triggerRef.current;
      const tabbables = tabbablesOutside(panelRef.current);
      const index = trigger ? tabbables.indexOf(trigger) : -1;
      const target =
        index >= 0
          ? tabbables[index + direction] ?? null
          : direction > 0
            ? tabbables[0] ?? null
            : tabbables[tabbables.length - 1] ?? null;
      setOpen(false);
      setOpenSubmenu(null);
      setPosition(null);
      if (target) requestAnimationFrame(() => target.focus());
      else trigger?.focus();
    },
    [],
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    const root = rootRef.current;
    if (!trigger || !panel || !root) return;
    const triggerRect = trigger.getBoundingClientRect();
    // Use the layout box rather than the bounding rect: the entry animation
    // scales the panel for a few frames and getBoundingClientRect() would
    // measure that temporary transform and anchor the menu a few pixels off.
    const next = computeMenuPosition(
      triggerRect,
      { width: panel.offsetWidth, height: panel.offsetHeight },
      viewportSize(),
      { align, side },
    );
    // Absolute panels are positioned inside the root's padding box; fixed
    // panels use the viewport coordinates directly.
    const rootRect = root.getBoundingClientRect();
    const resolved = fixed
      ? next
      : {
          top: next.top - (rootRect.top + root.clientTop),
          left: next.left - (rootRect.left + root.clientLeft),
        };
    setPosition((current) =>
      current && current.top === resolved.top && current.left === resolved.left
        ? current
        : resolved,
    );
  }, [align, fixed, side]);

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
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = menuItemsIn(panel);
      const target =
        pendingOpenFocusRef.current === 'last'
          ? focusable[focusable.length - 1]
          : focusable[0];
      pendingOpenFocusRef.current = 'first';
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Keyboard-opened submenus move focus into the submenu once it mounts.
  useEffect(() => {
    if (!open || !openSubmenu || !pendingSubmenuFocusRef.current) return;
    pendingSubmenuFocusRef.current = false;
    const frame = requestAnimationFrame(() => {
      const submenu = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('[data-submenu-panel]') ?? [],
      ).find((element) => element.dataset.submenuPanel === openSubmenu);
      if (!submenu) return;
      menuItemsIn(submenu)[0]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, openSubmenu]);

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const currentMenu = target.closest<HTMLElement>('[role="menu"]');
    const inSubmenu = currentMenu !== null && currentMenu !== event.currentTarget;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (inSubmenu && currentMenu?.dataset.submenuPanel) {
        focusSubmenuTrigger(currentMenu.dataset.submenuPanel);
        return;
      }
      if (openSubmenu) {
        // A submenu opened by hover/click is closed first; the next Escape
        // closes the menu itself.
        focusSubmenuTrigger(openSubmenu);
        return;
      }
      close();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      closeAndMoveFocusOut(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === 'ArrowRight') {
      const submenuTrigger = target.closest<HTMLElement>('[data-submenu-trigger="true"]');
      const submenuId = submenuTrigger?.dataset.submenuId;
      if (submenuId) {
        event.preventDefault();
        openSubmenuWithFocus(submenuId);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      if (inSubmenu && currentMenu?.dataset.submenuPanel) {
        event.preventDefault();
        focusSubmenuTrigger(currentMenu.dataset.submenuPanel);
        return;
      }
      if (openSubmenu) {
        event.preventDefault();
        focusSubmenuTrigger(openSubmenu);
      }
      return;
    }

    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    // Keep arrow roving scoped to the submenu that has focus, not the whole
    // panel (which also contains the parent items).
    const menu = inSubmenu && currentMenu ? currentMenu : event.currentTarget;
    const focusable = menuItemsIn(menu);
    if (focusable.length === 0) return;
    event.preventDefault();
    const active = document.activeElement;
    const index = focusable.findIndex((element) => element === active);
    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = focusable.length - 1;
    else if (event.key === 'ArrowDown') {
      nextIndex = index < 0 ? 0 : (index + 1) % focusable.length;
    } else {
      nextIndex = index <= 0 ? focusable.length - 1 : index - 1;
    }
    focusable[nextIndex]?.focus();
  };

  /**
   * Escape while focus sits on the trigger (after a click-open) still closes;
   * ArrowDown/ArrowUp on the closed trigger opens the menu at the first/last
   * item, matching the WAI-ARIA menu button pattern.
   */
  const handleRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (!open) {
      if (
        event.target === triggerRef.current &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      ) {
        event.preventDefault();
        openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
      }
      return;
    }
    if (event.key !== 'Escape') return;
    if (panelRef.current?.contains(event.target as Node)) return;
    event.preventDefault();
    close();
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
      onKeyDown={handleRootKeyDown}
    >
      {trigger({
        onClick: () => {
          if (open) {
            setOpen(false);
            setOpenSubmenu(null);
          } else {
            openMenu('first');
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
          className={cn(styles.panel, fixed && styles.panelFixed)}
          data-side={side}
          data-align={align}
          style={position ? { top: position.top, left: position.left } : undefined}
          onKeyDown={handlePanelKeyDown}
        >
          {header ? <div className={styles.menuHeader}>{header}</div> : null}
          {items.map((item, index) => {
            if (isSeparator(item)) {
              return <div key={item.id} role="separator" className={styles.separator} />;
            }
            if (isSubmenu(item)) {
              const expanded = openSubmenu === item.id;
              const submenuId = `${panelId}-submenu-${index}`;
              return (
                <div key={item.id} className={styles.submenuRoot}>
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={expanded}
                    aria-controls={submenuId}
                    className={styles.item}
                    data-menu-item="true"
                    data-submenu-trigger="true"
                    data-submenu-id={item.id}
                    onClick={() =>
                      expanded ? setOpenSubmenu(null) : openSubmenuWithFocus(item.id)
                    }
                    onMouseEnter={() => setOpenSubmenu(item.id)}
                  >
                    {item.icon ? <Icon name={item.icon} size={18} className={styles.itemIcon} /> : null}
                    <span className={styles.itemLabel}>{item.label}</span>
                    <Icon name="chevron_right" size={18} className={styles.itemChevron} />
                  </button>
                  {expanded ? (
                    <div
                      id={submenuId}
                      role="menu"
                      aria-label={item.label}
                      className={styles.submenuPanel}
                      data-submenu-panel={item.id}
                    >
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
