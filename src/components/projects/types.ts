/**
 * Re-export of the serialisable project view models.
 *
 * The runtime definitions live in `src/lib/projects.ts` (AR-028) so the
 * framework-free domain layer never imports from the component tree. Client
 * components can keep importing from here or `@/lib/projects`.
 */
export * from '@/lib/projects';
