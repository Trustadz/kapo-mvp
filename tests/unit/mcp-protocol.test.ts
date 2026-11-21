import { describe, expect, it } from 'vitest';
import {
  MCP_LATEST_PROTOCOL_VERSION,
  handleRpcMessage,
  handleRpcPayload,
  type McpProtocolContext,
} from '@/server/mcp/protocol';
import type { AuthUser } from '@/lib/types';

/**
 * Protocol shape without a database or HTTP surface.
 *
 * `initialize`, `ping`, `tools/list` and `whoami` never touch the database, so
 * a fake context is enough to pin the JSON-RPC contract and its error codes.
 */

const context: McpProtocolContext = {
  db: {} as never,
  user: {
    id: 'user-1',
    username: 'maya',
    appRole: 'user',
    showArchived: false,
  } as unknown as AuthUser,
  accessUser: {
    id: 'user-1',
    appRole: 'user',
    showArchived: false,
    via: { channel: 'mcp', agent: 'Claude Desktop', tokenId: 'token-1' },
  },
  tokenLabel: 'Claude Desktop',
};

function message(method: string, params?: unknown, id: string | number | null = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

describe('initialize', () => {
  it('echoes a supported protocol version and advertises tools', () => {
    const response = handleRpcMessage(context, {
      ...message('initialize'),
      params: { protocolVersion: '2025-03-26', capabilities: {} },
    });
    expect(response?.result).toMatchObject({
      protocolVersion: '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'kapo' },
    });
  });

  it('falls back to the newest version for an unknown request', () => {
    const response = handleRpcMessage(context, {
      ...message('initialize'),
      params: { protocolVersion: '1999-01-01' },
    });
    expect((response?.result as { protocolVersion: string }).protocolVersion).toBe(
      MCP_LATEST_PROTOCOL_VERSION,
    );
  });
});

describe('messages and notifications', () => {
  it('answers ping', () => {
    const response = handleRpcMessage(context, message('ping'));
    expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('returns null for notifications (including notifications/initialized)', () => {
    expect(
      handleRpcMessage(context, { jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toBeNull();
    expect(handleRpcMessage(context, { jsonrpc: '2.0', method: 'notifications/cancelled' })).toBeNull();
  });

  it('rejects invalid messages with -32600', () => {
    const response = handleRpcMessage(context, { id: 1, method: 'ping' });
    expect(response).toMatchObject({ id: null, error: { code: -32600 } });
    expect(handleRpcMessage(context, 'nope')).toMatchObject({ error: { code: -32600 } });
  });

  it('returns -32601 for unknown methods', () => {
    const response = handleRpcMessage(context, message('resources/list'));
    expect(response).toMatchObject({ id: 1, error: { code: -32601 } });
  });

  it('drops notifications inside a batch but answers requests', () => {
    const { responses, hadRequests } = handleRpcPayload(context, [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      message('ping', undefined, 'abc'),
    ]);
    expect(hadRequests).toBe(true);
    expect(responses).toEqual([{ jsonrpc: '2.0', id: 'abc', result: {} }]);
  });

  it('reports a notification-only payload as having no requests', () => {
    const { responses, hadRequests } = handleRpcPayload(context, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(hadRequests).toBe(false);
    expect(responses).toEqual([]);
  });
});

describe('tools', () => {
  it('lists tool metadata without handlers or internal fields', () => {
    const response = handleRpcMessage(context, message('tools/list'));
    const tools = (response?.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(10);
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.handler).toBeUndefined();
    }
  });

  it('calls whoami as the token owner with the label', () => {
    const response = handleRpcMessage(
      context,
      message('tools/call', { name: 'whoami', arguments: {} }),
    );
    const result = response?.result as {
      structuredContent: { username: string; mcp: { tokenLabel: string } };
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.username).toBe('maya');
    expect(result.structuredContent.mcp.tokenLabel).toBe('Claude Desktop');
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(result.structuredContent);
  });

  it('rejects unknown tools with -32602', () => {
    const response = handleRpcMessage(
      context,
      message('tools/call', { name: 'nope', arguments: {} }),
    );
    expect(response).toMatchObject({ error: { code: -32602 } });
  });

  it('rejects missing or invalid arguments with -32602', () => {
    const missing = handleRpcMessage(
      context,
      message('tools/call', { name: 'create_project', arguments: {} }),
    );
    expect(missing).toMatchObject({ error: { code: -32602 } });

    const wrongShape = handleRpcMessage(
      context,
      message('tools/call', { name: 'create_project', arguments: ['not', 'an', 'object'] }),
    );
    expect(wrongShape?.result).toMatchObject({ isError: true });
  });
});
