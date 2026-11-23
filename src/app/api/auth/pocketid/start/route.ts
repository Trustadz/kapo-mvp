import { NextResponse } from 'next/server';
import * as client from 'openid-client';
import { setOidcTransactionCookie } from '@/server/auth/cookies';
import {
  getOidcClient,
  getOidcConfig,
  oidcErrorRedirect,
  oidcRedirectUri,
} from '@/server/auth/oidc';
import { signOidcTransaction } from '@/server/auth/oidc-state';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/pocketid/start — begins the PocketID authorization-code flow.
 *
 * State, nonce and the PKCE verifier are stored in a signed, short-lived
 * httpOnly cookie. The callback route is the only place that consumes it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const config = getOidcConfig();
  if (!config.enabled) return oidcErrorRedirect(request, 'sso_unavailable');

  try {
    const oidc = await getOidcClient(config);
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const redirectUri = oidcRedirectUri(config, request);

    const authorizationUrl = client.buildAuthorizationUrl(oidc, {
      redirect_uri: redirectUri,
      scope: config.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    await setOidcTransactionCookie(
      signOidcTransaction({ state, nonce, codeVerifier, createdAt: Date.now() }),
    );
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    console.error('[oidc] could not start sign-in', error);
    return oidcErrorRedirect(request, 'sso_unavailable');
  }
}
