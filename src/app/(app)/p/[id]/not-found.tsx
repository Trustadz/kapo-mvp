import Link from 'next/link';
import { Button, EmptyState } from '@/components/ui';

/** Projects are permission filtered; an inaccessible project is indistinguishable from a missing one. */
export default function ProjectNotFound() {
  return (
    <EmptyState
      level={1}
      icon="lock"
      title="Project not available"
      description="It may not exist, or you may not have access to it."
      action={
        <Link href="/">
          <Button variant="quiet">Go to Home</Button>
        </Link>
      }
    />
  );
}
