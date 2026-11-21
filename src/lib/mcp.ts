/**
 * Client-safe MCP types.
 *
 * The server domain lives in `src/server/auth/mcp-token.ts`; client components
 * must not import it, so the shape is declared here and reused by the server.
 */

export interface McpTokenSummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Maximum number of active (non-revoked) tokens one user may hold. */
export const MCP_TOKEN_LIMIT = 10;

/** Labels are short display names, not free-form descriptions. */
export const MCP_TOKEN_LABEL_MAX_LENGTH = 60;
