import { redirect } from 'next/navigation';

/** /trash redirects to the Trash tab of /search (build-spec §4). */
export default function TrashRedirectPage() {
  redirect('/search?tab=trash');
}
