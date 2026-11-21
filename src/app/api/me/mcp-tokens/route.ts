import { apiRoute } from '@/server/api-route';
import { jsonError, jsonOk, readJsonBody } from '@/server/http';
import { getApplicationSettings } from '@/server/domain/settings';
import {
  createMcpToken,
  isValidMcpTokenLabel,
  listMcpTokens,
} from '@/server/auth/mcp-token';
import { MCP_TOKEN_LABEL_MAX_LENGTH, MCP_TOKEN_LIMIT } from '@/lib/mcp';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/mcp-tokens — the current user's MCP tokens (never the raw value).
 * POST /api/me/mcp-tokens — create one; the raw token is returned exactly once.
 *
 * Personal credentials, so no Admin role is required. Application Viewers may
 * create a token: it is read-only by virtue of their role, which the domain
 * already enforces on every write.
 */

export const GET = apiRoute(async ({ db, user }) => {
  return jsonOk({
    enabled: getApplicationSettings(db).mcpEnabled,
    tokens: listMcpTokens(db, user.id),
  });
});

export const POST = apiRoute(
  async ({ db, request, user }) => {
    if (!getApplicationSettings(db).mcpEnabled) {
      return jsonError(403, 'mcp_disabled', 'MCP access is disabled for this installation.');
    }

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const label = body.data.label;
    if (!isValidMcpTokenLabel(label)) {
      return jsonError(422, 'validation_failed', 'Check the highlighted fields.', {
        label:
          typeof label === 'string' && label.trim().length > MCP_TOKEN_LABEL_MAX_LENGTH
            ? `Use ${MCP_TOKEN_LABEL_MAX_LENGTH} characters or fewer.`
            : 'Enter a name for this token.',
      });
    }

    const active = listMcpTokens(db, user.id).filter((token) => token.revokedAt === null);
    if (active.length >= MCP_TOKEN_LIMIT) {
      return jsonError(
        422,
        'token_limit',
        `You can have at most ${MCP_TOKEN_LIMIT} active tokens. Revoke one first.`,
      );
    }

    const created = createMcpToken(db, user.id, label);
    return jsonOk({ token: created.token, summary: created.summary }, { status: 201 });
  },
  { mutation: true },
);
