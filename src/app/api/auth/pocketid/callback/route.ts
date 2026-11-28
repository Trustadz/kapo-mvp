import { NextResponse } from 'next/server';
import * as client from 'openid-client';
import {
  clearOidcTransactionCookie,
  readOidcTransactionCookie,
  setAppearanceCookie,
  setSessionCookie,
} from '@/server/auth/cookies';
import { countUsers } from '@/server/auth/current-user';
import { fetchOidcAvatar } from '@/server/auth/oidc-avatar';
import {
  appBaseUrl,
  getOidcClient,
  getOidcConfig,
  mapOidcClaims,
  OidcLoginError,
  oidcCallbackUrl,
  oidcErrorRedirect,
} from '@/server/auth/oidc';
import { verifyOidcTransaction } from '@/server/auth/oidc-state';
import { createSession, deleteExpiredSessions } from '@/server/auth/session';
import { getDb } from '@/server/db/connection';
import { resolveOidcUser } from '@/server/domain/identities';
import { resolveLandingHref, saveAvatar } from '@/server/domain/users';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/pocketid/callback — completes PocketID sign-in.
 *
 * The external subject is resolved to a local Kapo user (existing email match
 * or a new Viewer), then a normal database-backed Kapo session is created.
 * Every downstream guard and API route is therefore unchanged by SSO.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const config = getOidcConfig();
  if (!config.enabled) return oidcErrorRedirect(request, 'sso_unavailable');

  const transaction = verifyOidcTransaction(await readOidcTransactionCookie());
  await clearOidcTransactionCookie();
  if (!transaction) return oidcErrorRedirect(request, 'sso_state_invalid');

  const currentUrl = new URL(request.url);
  const returnedState = currentUrl.searchParams.get('state');
  if (returnedState !== transaction.state) {
    return oidcErrorRedirect(request, 'sso_state_invalid');
  }
  if (currentUrl.searchParams.has('error')) {
    return oidcErrorRedirect(
      request,
      currentUrl.searchParams.get('error') === 'access_denied'
        ? 'sso_denied'
        : 'sso_failed',
    );
  }

  const db = getDb();
  if (countUsers(db) === 0) {
    // Never let an external login create the first account: /setup owns the
    // bootstrap Admin and the Root project.
    return NextResponse.redirect(new URL('/setup', appBaseUrl(config, request)));
  }

  try {
    const oidc = await getOidcClient(config);
    const tokens = await client.authorizationCodeGrant(
      oidc,
      oidcCallbackUrl(config, request),
      {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
      },
    );
    const idTokenClaims = tokens.claims();
    if (!idTokenClaims) {
      throw new OidcLoginError('invalid_claims', 'PocketID returned no ID token.');
    }
    const claims = mapOidcClaims(idTokenClaims as Record<string, unknown>);
    const { user } = await resolveOidcUser(db, config.issuer, claims, {
      autoProvision: config.autoProvision,
    });

    // Best effort: import the provider's picture only when Kapo has no avatar
    // yet, so a local upload is never overwritten. Failure never blocks login.
    if (config.importAvatar && !user.avatar && claims.picture) {
      try {
        const avatar = await fetchOidcAvatar(claims.picture, {
          issuer: config.issuer,
          allowInsecure: config.allowInsecure,
          accessToken: tokens.access_token,
        });
        if (avatar) saveAvatar(db, user.id, avatar.buffer, avatar.mime);
      } catch (error) {
        console.warn(
          '[oidc] avatar import skipped:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    deleteExpiredSessions(db);
    const session = createSession(db, user.id);
    await setSessionCookie(session.token, session.expiresAt);
    await setAppearanceCookie(user.appearance);
    return NextResponse.redirect(
      new URL(resolveLandingHref(db, user), appBaseUrl(config, request)),
    );
  } catch (error) {
    if (error instanceof OidcLoginError) {
      console.warn(`[oidc] sign-in rejected: ${error.code}`);
      return oidcErrorRedirect(request, error.code);
    }
    if (error instanceof client.AuthorizationResponseError) {
      console.warn(`[oidc] authorization response rejected: ${error.error}`);
      return oidcErrorRedirect(request, 'sso_failed');
    }
    console.error('[oidc] callback failed', error);
    return oidcErrorRedirect(request, 'sso_failed');
  }
}
