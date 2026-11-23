/**
 * Standalone mock OIDC provider for the Playwright SSO smoke test.
 *
 * Playwright starts this next to the Kapo server and points KAPO_OIDC_ISSUER
 * at it. The default user matches the seeded Admin email, so the smoke test
 * proves email matching preserves an existing Admin role.
 */
import { startMockOidcServer } from '../helpers/mock-oidc-server';

const port = Number(process.env.MOCK_OIDC_PORT ?? '3402');

async function main(): Promise<void> {
  const server = await startMockOidcServer({
    port,
    user: {
      sub: 'e2e-admin-sub',
      email: 'admin@example.com',
      email_verified: true,
      preferred_username: 'admin',
      name: 'Admin',
    },
  });

  server.setUser({ ...server.getUser(), picture: `${server.url}/avatar` });
  console.log(`[mock-oidc] listening on ${server.url}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.close().finally(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  console.error('[mock-oidc] failed to start', error);
  process.exitCode = 1;
});
