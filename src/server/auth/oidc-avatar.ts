import {
  AVATAR_ALLOWED_MIME,
  MAX_AVATAR_BYTES,
} from '@/server/domain/users';

/**
 * Best-effort import of the OIDC `picture` claim into Kapo's local avatar
 * storage.
 *
 * The claim is a URL controlled by the identity provider, so this is treated
 * as untrusted network input:
 *
 * - only HTTPS (HTTP only with the explicit local-testing switch);
 * - only the issuer's own origin, which keeps the request from becoming an
 *   SSRF probe into the container network;
 * - no redirects, a five-second timeout, and the avatar size/MIME limits;
 * - the bytes still go through `saveAvatar`, which validates magic bytes.
 *
 * Returning null means "nothing safe to import"; the caller must continue the
 * sign-in without an avatar.
 */

export const AVATAR_FETCH_TIMEOUT_MS = 5_000;

export interface OidcAvatarOptions {
  issuer: string;
  allowInsecure: boolean;
  accessToken?: string;
}

export interface OidcAvatar {
  buffer: Buffer;
  mime: string;
}

async function requestPicture(
  url: URL,
  accessToken: string | undefined,
): Promise<Response> {
  return fetch(url, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
    headers: {
      accept: AVATAR_ALLOWED_MIME.join(', '),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
  });
}

export async function fetchOidcAvatar(
  pictureUrl: string,
  options: OidcAvatarOptions,
): Promise<OidcAvatar | null> {
  let url: URL;
  let issuerOrigin: string;
  try {
    url = new URL(pictureUrl);
    issuerOrigin = new URL(options.issuer).origin;
  } catch {
    return null;
  }

  const protocolAllowed =
    url.protocol === 'https:' || (options.allowInsecure && url.protocol === 'http:');
  if (
    !protocolAllowed ||
    url.username !== '' ||
    url.password !== '' ||
    url.origin !== issuerOrigin
  ) {
    return null;
  }

  // PocketID may serve profile pictures publicly or may expect the access
  // token; try anonymously first and retry once on 401/403.
  let response = await requestPicture(url, undefined);
  if (
    (response.status === 401 || response.status === 403) &&
    options.accessToken
  ) {
    response = await requestPicture(url, options.accessToken);
  }
  if (!response.ok) return null;

  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES) {
    return null;
  }

  const declared =
    (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ??
    '';
  const contentType = declared === 'image/jpg' ? 'image/jpeg' : declared;
  if (
    contentType &&
    !(AVATAR_ALLOWED_MIME as readonly string[]).includes(contentType)
  ) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) return null;
  return { buffer, mime: contentType };
}
