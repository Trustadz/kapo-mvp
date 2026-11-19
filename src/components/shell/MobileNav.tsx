'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { CaptureForm } from './CaptureForm';
import styles from './MobileNav.module.css';

export interface MobileNavProps {
  rootProjectId: string | null;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Mobile bottom bar: Home / Root / Add / Inbox / Search (build-spec §8). */
export function MobileNav({ rootProjectId }: MobileNavProps) {
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);

  const close = () => setAddOpen(false);

  return (
    <>
      <nav className={styles.bar} aria-label="Mobile navigation">
        <Link
          href="/"
          className={cn(styles.tab, pathname === '/' && styles.active)}
          aria-current={pathname === '/' ? 'page' : undefined}
        >
          <Icon name="home" size={22} />
          <span className={styles.label}>Home</span>
        </Link>
        {rootProjectId ? (
          <Link
            href={`/p/${rootProjectId}`}
            className={cn(styles.tab, isActive(pathname, `/p/${rootProjectId}`) && styles.active)}
            aria-current={isActive(pathname, `/p/${rootProjectId}`) ? 'page' : undefined}
          >
            <Icon name="account_tree" size={22} />
            <span className={styles.label}>Root</span>
          </Link>
        ) : null}
        <button
          type="button"
          className={cn(styles.tab, styles.addTab)}
          onClick={() => setAddOpen(true)}
          aria-label="Add a project to Root"
          aria-haspopup="dialog"
        >
          <Icon name="add" size={24} />
          <span className={styles.label}>Add</span>
        </button>
        <Link
          href="/inbox"
          className={cn(styles.tab, isActive(pathname, '/inbox') && styles.active)}
          aria-current={isActive(pathname, '/inbox') ? 'page' : undefined}
        >
          <Icon name="inbox" size={22} />
          <span className={styles.label}>Inbox</span>
        </Link>
        <Link
          href="/search"
          className={cn(styles.tab, isActive(pathname, '/search') && styles.active)}
          aria-current={isActive(pathname, '/search') ? 'page' : undefined}
        >
          <Icon name="search" size={22} />
          <span className={styles.label}>Search</span>
        </Link>
      </nav>

      <Dialog
        open={addOpen}
        onClose={close}
        title="Add a project"
        description="Creates a Root child in Inbox."
        size="sm"
      >
        <CaptureForm
          rootProjectId={rootProjectId}
          variant="mobile"
          autoFocus
          onSuccess={close}
          onCancel={close}
        />
      </Dialog>
    </>
  );
}
