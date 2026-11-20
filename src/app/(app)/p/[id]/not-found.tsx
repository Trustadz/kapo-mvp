import Link from 'next/link';
import { Button, EmptyState } from '@/components/ui';
import { getI18n } from '@/i18n/server';

/** Projects are permission filtered; an inaccessible project is indistinguishable from a missing one. */
export default async function ProjectNotFound() {
  const { t } = await getI18n();
  return (
    <EmptyState
      level={1}
      icon="lock"
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={
        <Link href="/">
          <Button variant="quiet">{t('notFound.goHome')}</Button>
        </Link>
      }
    />
  );
}
