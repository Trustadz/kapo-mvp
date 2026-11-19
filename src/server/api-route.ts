import type { NextResponse } from 'next/server';
import type { AuthUser } from '@/lib/types';
import { getSessionUser } from './auth/current-user';
import { getDb, type BetterSqliteDatabase } from './db/connection';
import { DomainError, type AccessUser } from './domain/permissions';
import { isSameOrigin, jsonError, rejectCrossOrigin, type ApiErrorPayload } from './http';

/**
 * Single JSON route-handler helper for every API route (AR-041/AR-042).
 *
 * Resolves the session exactly once, enforces the same-origin CSRF check for
 * mutating handlers, exposes the strongly-typed route params and maps domain
 * errors (DomainError, and the account/settings errors by their shared
 * status/code/message/fields shape) onto the build-spec §7 envelope. Unknown
 * errors are logged and returned as a JSON 500 instead of Next's HTML/empty 500.
 *
 * Usage:
 *   export const GET = apiRoute<{ id: string }>(async ({ db, accessUser, params }) => …);
 *   export const POST = apiRoute(async ({ request }) => …, { mutation: true });
 */

export interface ApiContext<P extends Record<string, string> = Record<string, string>> {
  request: Request;
  params: P;
  user: AuthUser;
  accessUser: AccessUser;
  db: BetterSqliteDatabase;
}

export interface ApiRouteOptions {
  /** Same-origin check for POST/PATCH/PUT/DELETE handlers. */
  mutation?: boolean;
}

type ApiHandler<P extends Record<string, string>> = (
  context: ApiContext<P>,
) => Promise<NextResponse> | NextResponse;

type RouteRequestContext<P extends Record<string, string>> = {
  params: Promise<P>;
};

export function toAccessUser(user: AuthUser): AccessUser {
  return { id: user.id, appRole: user.appRole, showArchived: user.showArchived };
}

interface EnvelopeError {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

function isEnvelopeError(error: unknown): error is EnvelopeError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status <= 599 &&
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.message === 'string' &&
    (candidate.fields === undefined ||
      (typeof candidate.fields === 'object' && candidate.fields !== null))
  );
}

/** Maps any thrown value onto the API error envelope. */
export function mapApiError(error: unknown): NextResponse<ApiErrorPayload> {
  if (error instanceof DomainError) {
    return jsonError(error.status, error.code, error.message, error.fields);
  }
  if (isEnvelopeError(error)) {
    return jsonError(error.status, error.code, error.message, error.fields);
  }
  console.error('[api] unhandled error', error);
  return jsonError(500, 'internal', 'Something went wrong. Try again.');
}

export function apiRoute<P extends Record<string, string> = Record<string, string>>(
  handler: ApiHandler<P>,
  options: ApiRouteOptions = {},
): (request: Request, context: RouteRequestContext<P>) => Promise<NextResponse> {
  return async (request, context) => {
    try {
      if (options.mutation && !isSameOrigin(request)) return rejectCrossOrigin();
      const user = await getSessionUser();
      if (!user) {
        return jsonError(401, 'unauthenticated', 'Sign in to continue.');
      }
      const params = context?.params ? await context.params : ({} as P);
      const db = getDb();
      return await handler({
        request,
        params,
        user,
        accessUser: toAccessUser(user),
        db,
      });
    } catch (error) {
      return mapApiError(error);
    }
  };
}
