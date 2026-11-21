import { apiRoute } from '@/server/api-route';
import { jsonError, jsonOk } from '@/server/http';
import { revokeMcpToken } from '@/server/auth/mcp-token';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/**
 * DELETE /api/me/mcp-tokens/:id — revoke one of the current user's tokens.
 *
 * Revocation keeps working while MCP access is disabled, so a user can always
 * clean up credentials. 404 covers both "unknown id" and "another user's id".
 */
export const DELETE = apiRoute<Params>(
  async ({ db, params, user }) => {
    const revoked = revokeMcpToken(db, user.id, params.id);
    if (!revoked) {
      return jsonError(404, 'not_found', 'Token not found.');
    }
    return jsonOk({ revoked: true });
  },
  { mutation: true },
);
