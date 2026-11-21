import { DomainError } from '../domain/permissions';
import {
  McpToolInputError,
  findTool,
  listToolMetadata,
  type McpToolContext,
} from './tools';

/**
 * Minimal MCP server over JSON-RPC 2.0 (Streamable HTTP, POST only).
 *
 * Stateless on purpose: this app runs as one process over one SQLite file, so
 * there is nothing to keep between requests except the token and the database.
 * The transport layer (src/app/api/mcp/route.ts) owns authentication; this
 * module owns protocol shape and error mapping so it can be unit-tested without
 * a browser, Next.js or a real HTTP request.
 */

export const MCP_SERVER_NAME = 'kapo';
export const MCP_SERVER_VERSION = '0.4.0';

/** Newest first. The server echoes the client's version when it is supported. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];

export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpProtocolContext extends McpToolContext {
  /** The user-chosen label of the token; shown in history as "via …". */
  tokenLabel: string;
}

export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

const INSTRUCTIONS =
  'Kapo is a self-hosted household project board. You act as the person who created this MCP token; ' +
  'their permissions apply and every change is recorded in project history as that person, marked with ' +
  'the token label. Prefer reading before writing: call get_project to discover status ids and add-on ' +
  'fields. Never guess a status id. Trashed projects are read-only.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidJsonRpcMessage(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (value.jsonrpc !== '2.0') return false;
  if (typeof value.method !== 'string' || value.method.length === 0) return false;
  if (value.id !== undefined && value.id !== null) {
    const type = typeof value.id;
    if (type !== 'string' && type !== 'number') return false;
  }
  return true;
}

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function errorText(error: unknown): string {
  if (error instanceof DomainError) {
    const fields = error.fields ?? {};
    if (Object.keys(fields).length > 0) {
      const lines = Object.entries(fields).map(([field, message]) => `${field}: ${message}`);
      return `${error.message}\n${lines.join('\n')}`;
    }
    return error.message;
  }
  if (error instanceof McpToolInputError) return error.message;
  return 'The tool failed. Nothing was changed.';
}

function toolError(message: string): McpToolCallResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function selectProtocolVersion(params: Record<string, unknown>): string {
  const requested = params.protocolVersion;
  if (
    typeof requested === 'string' &&
    (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }
  return MCP_LATEST_PROTOCOL_VERSION;
}

function initialize(params: Record<string, unknown>): unknown {
  return {
    protocolVersion: selectProtocolVersion(params),
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    instructions: INSTRUCTIONS,
  };
}

function callTool(
  context: McpProtocolContext,
  params: Record<string, unknown>,
): McpToolCallResult {
  const name = params.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new McpToolInputError('"name" is required.');
  }
  const tool = findTool(name);
  if (!tool) {
    // Unknown *tool* is a protocol-level invalid-params error, not a tool result.
    throw new McpToolInputError(`Unknown tool: ${name}`);
  }
  const rawArgs = params.arguments;
  if (rawArgs !== undefined && rawArgs !== null && !isRecord(rawArgs)) {
    return toolError('"arguments" must be an object.');
  }
  const args = isRecord(rawArgs) ? rawArgs : {};
  const data = tool.handler(context, args);
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/**
 * Handles one JSON-RPC message.
 *
 * Returns `null` for notifications (no response is allowed, not even an empty
 * one). Throws only for malformed input; protocol and tool errors are encoded
 * in the returned response so the HTTP request itself stays 200.
 */
export function handleRpcMessage(
  context: McpProtocolContext,
  message: unknown,
): JsonRpcResponse | null {
  if (!isValidJsonRpcMessage(message)) {
    return failure(null, -32600, 'Invalid Request.');
  }
  const request = message;
  const isNotification = request.id === undefined;
  const id: JsonRpcId = isNotification ? null : (request.id as JsonRpcId);
  const params = isRecord(request.params) ? request.params : {};

  if (isNotification) {
    // notifications/initialized, notifications/cancelled, …: acknowledge by
    // returning nothing. The transport answers 202 with no body.
    return null;
  }

  switch (request.method) {
    case 'initialize':
      return success(id, initialize(params));
    case 'ping':
      return success(id, {});
    case 'tools/list':
      return success(id, { tools: listToolMetadata() });
    case 'tools/call': {
      try {
        return success(id, callTool(context, params));
      } catch (error) {
        if (error instanceof McpToolInputError) {
          return failure(id, -32602, error.message);
        }
        return success(id, toolError(errorText(error)));
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${String(request.method)}`);
  }
}

/** Handles a single message or a JSON-RPC batch; notifications are dropped. */
export function handleRpcPayload(
  context: McpProtocolContext,
  payload: unknown,
): { responses: JsonRpcResponse[]; hadRequests: boolean } {
  if (Array.isArray(payload)) {
    const responses: JsonRpcResponse[] = [];
    let hadRequests = false;
    for (const message of payload) {
      const response = handleRpcMessage(context, message);
      if (response) {
        hadRequests = true;
        responses.push(response);
      }
    }
    return { responses, hadRequests };
  }
  const response = handleRpcMessage(context, payload);
  return { responses: response ? [response] : [], hadRequests: response !== null };
}
