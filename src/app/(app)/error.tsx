'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button, Card, Icon } from '@/components/ui';
import styles from './error.module.css';

/**
 * In-shell route error state (design review F05; Penpot 10 → 04 Search · Error).
 *
 * Rendered inside the authenticated `(app)` layout, so the sidebar, top bar,
 * capture field and theme stay intact instead of the framework's generic error
 * page. Search keeps its designed copy; other routes get the generic Kapo copy.
 * The current query is still in the URL, so Retry re-runs the same page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const isSearch = pathname === '/search';

  return (
    <div className={styles.wrap} role="alert">
      <Card className={styles.panel}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="cloud_off" size={32} />
        </span>
        <h1 className={styles.title}>
          {isSearch ? 'Search is unavailable' : 'This page couldn’t load'}
        </h1>
        <p className={styles.body}>
          {isSearch
            ? 'Your query is preserved. Retry when Kapo is available.'
            : 'Something went wrong while loading this page. Retry, or use the navigation to keep working.'}
        </p>
        {error.digest ? <p className={styles.digest}>Reference: {error.digest}</p> : null}
        <div className={styles.actions}>
          <Button onClick={() => reset()} icon={<Icon name="refresh" size={20} />}>
            Retry
          </Button>
          <Link href="/" className={styles.secondary}>
            Go to Home
          </Link>
        </div>
      </Card>
    </div>
  );
}
