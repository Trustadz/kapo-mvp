'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { Toast } from '@/components/ui/Toast';
import { useToastMessage } from '@/components/ui/use-live-announcer';
import type { AuthUser, Appearance } from '@/lib/types';
import { APPEARANCE_LABELS, ACCOUNT_ROLE_LABELS } from '@/lib/types';
import { formatPersonName } from '@/lib/format';
import { applyAppearance } from '@/lib/theme';
import { cn } from '@/lib/cn';
import styles from './AccountMenu.module.css';

export interface AccountMenuProps {
  user: AuthUser;
  variant?: 'sidebar' | 'compact';
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  className?: string;
}

/**
 * Account block/menu: Profile, Appearance (Light/Dark/System), Admin-only
 * Settings and Users, then Sign out. Used by the desktop sidebar and the mobile
 * header avatar.
 */
export function AccountMenu({
  user,
  variant = 'sidebar',
  side = 'top',
  align = 'start',
  className,
}: AccountMenuProps) {
  const router = useRouter();
  const displayName = formatPersonName(user.username);
  const [appearance, setAppearance] = useState<Appearance>(user.appearance);
  const { toast, notify, dismiss } = useToastMessage();

  const changeAppearance = useCallback(
    async (preference: Appearance) => {
      setAppearance(preference);
      applyAppearance(preference);
      try {
        const response = await fetch('/api/me', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ appearance: preference }),
        });
        if (!response.ok) {
          notify('Appearance changed for this visit, but could not be saved.', 'error');
        }
      } catch {
        notify('Appearance changed for this visit, but could not be saved.', 'error');
      }
    },
    [],
  );

  const signOut = useCallback(() => {
    void (async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } finally {
        window.location.assign('/login');
      }
    })();
  }, []);

  const items: MenuItem[] = [
    { id: 'profile', label: 'Profile', icon: 'person', href: '/profile' },
    {
      id: 'appearance',
      label: 'Appearance',
      icon: 'palette',
      items: (['light', 'dark', 'system'] as const).map((option) => ({
        id: `appearance-${option}`,
        label: APPEARANCE_LABELS[option],
        icon: option === 'light' ? 'light_mode' : option === 'dark' ? 'dark_mode' : 'brightness_auto',
        selected: appearance === option,
        onSelect: () => {
          void changeAppearance(option);
        },
      })),
    },
  ];

  if (user.appRole === 'admin') {
    items.push(
      { id: 'admin-separator', separator: true },
      { id: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
      { id: 'users', label: 'Users', icon: 'group', href: '/users' },
    );
  }

  items.push(
    { id: 'signout-separator', separator: true },
    { id: 'signout', label: 'Sign out', icon: 'logout', onSelect: signOut },
  );

  const identity = (
    <div className={styles.identity}>
      <Avatar name={displayName} src={user.avatar} size={40} decorative />
      <span className={styles.identityText}>
        <span className={styles.identityName}>{displayName}</span>
        <span className={styles.identityRole}>{ACCOUNT_ROLE_LABELS[user.appRole]}</span>
      </span>
    </div>
  );

  return (
    <>
      <Menu
        label="Account menu"
        items={items}
        header={identity}
        side={side}
        align={align}
        className={cn(styles.menu, className)}
        trigger={(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className={cn(styles.trigger, variant === 'compact' && styles.compactTrigger)}
            aria-label={variant === 'compact' ? 'Account menu' : undefined}
          >
            <Avatar name={displayName} src={user.avatar} size={32} decorative />
            {variant === 'sidebar' ? (
              <>
                <span className={styles.name}>{displayName}</span>
                <Icon name="expand_more" size={18} className={styles.chevron} />
              </>
            ) : null}
          </button>
        )}
      />
      <Toast
        open={toast !== null}
        message={toast?.message ?? ''}
        tone={toast?.tone ?? 'error'}
        announcementKey={toast?.sequence}
        onClose={dismiss}
      />
    </>
  );
}
