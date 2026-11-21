import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/connection';
import { getApplicationSettings } from '@/server/domain/settings';
import { resolveMcpToken } from '@/server/auth/mcp-token';
import type { AccessUser } from '@/server/domain/permissions';
import { handleRpcPayload, type McpProtocolContext } from '@/server/mcp/protocol';
import { methodNotAllowed } from '@/server/http';

/**
 * MCP endpoint — Streamable HTTP, POST only, stateless.
 *
 * Auth is a personal bearer token (`Authorization: Bearer kapo_mcp_…`), never a
 * browser cookie, so the same-origin CSRF check does not apply. Every tool runs
 * as the token's owner and records `via` provenance on the audit event.
 *
 * Disabled by default: an Admin enables it in Settings → AI access. When off,
 * the endpoint answers 403 before looking at any token.
 */

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

function rpcError(status: number, code: number, message: string, headers?: HeadersInit) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code, message } },
    { status, headers: { ...NO_STORE, ...(headers ?? {}) } },
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export async function POST(request: Request): Promise<Response> {
  const db = getDb();

  if (!getApplicationSettings(db).mcpEnabled) {
    return NextResponse.json(
      {
        error: {
          code: 'mcp_disabled',
          message:
            'MCP access is disabled. An administrator can enable it in Settings → AI access.',
        },
      },
      { status: 403, headers: NO_STORE },
    );
  }

  const token = bearerToken(request);
  if (!token) {
    return rpcError(401, -32000, 'A personal MCP token is required.', {
      'www-authenticate': 'Bearer',
    });
  }
  const resolved = resolveMcpToken(db, token);
  if (!resolved) {
    return rpcError(401, -32000, 'This MCP token is invalid or has been revoked.', {
      'www-authenticate': 'Bearer',
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcError(400, -32700, 'Parse error: the body must be JSON.');
  }
  if (Array.isArray(payload) && payload.length === 0) {
    return rpcError(400, -32600, 'Invalid Request: empty batch.');
  }
  if (typeof payload !== 'object' || payload === null) {
    return rpcError(400, -32600, 'Invalid Request.');
  }

  const accessUser: AccessUser = {
    id: resolved.user.id,
    appRole: resolved.user.appRole,
    showArchived: resolved.user.showArchived,
    via: { channel: 'mcp', agent: resolved.label, tokenId: resolved.tokenId },
  };
  const context: McpProtocolContext = {
    db,
    user: resolved.user,
    accessUser,
    tokenLabel: resolved.label,
  };

  const { responses, hadRequests } = handleRpcPayload(context, payload);
  if (!hadRequests) {
    // Notifications only (for example notifications/initialized).
    return new NextResponse(null, { status: 202, headers: NO_STORE });
  }
  const body = Array.isArray(payload) ? responses : responses[0];
  return NextResponse.json(body, { status: 200, headers: NO_STORE });
}

export function GET() {
  return methodNotAllowed(['POST']);
}

export function PUT() {
  return methodNotAllowed(['POST']);
}

export function DELETE() {
  return methodNotAllowed(['POST']);
}
