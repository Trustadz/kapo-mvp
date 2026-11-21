import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { createTestDatabase, type TestDatabase } from '../helpers/db';
import {
  buildHouseholdFixture,
  getFinishStatus,
  type FixtureHousehold,
} from '../helpers/fixtures';
import { json, request, signIn, signOut } from '../helpers/api';
import { resetRequestContext } from '../helpers/request-context';
import { createMcpToken, revokeMcpToken } from '@/server/auth/mcp-token';
import {
  syncAddonRegistryAndSearch,
} from '@/server/domain/project-addons';
import { updateApplicationSettings } from '@/server/domain/settings';
import { listActivity } from '@/server/domain/audit';
import { updateProject } from '@/server/domain/projects';
import '@/server/addons';

/**
 * MCP endpoint integration through the real route handler and database.
 *
 * Covers the contract that matters for users: opt-in toggle, per-user bearer
 * tokens, the tool surface, permission enforcement, and the `via` provenance
 * written to project history. Token management routes are exercised too.
 */

vi.mock('next/headers', async () => {
  const context = await import('../helpers/request-context');
  return {
    cookies: async () => context.cookieJar,
    headers: async () => context.headerJar,
  };
});

const mcpRoute = await import('@/app/api/mcp/route');
const dashboardRoute = await import('@/app/api/dashboard/route');
const tokensRoute = await import('@/app/api/me/mcp-tokens/route');
const tokenRoute = await import('@/app/api/me/mcp-tokens/[id]/route');

let test: TestDatabase;
let db: BetterSqliteDatabase;
let household: FixtureHousehold;
let mayaToken = '';
let alexToken = '';

const EMPTY_CONTEXT = { params: Promise.resolve({}) };

function rpc(
  body: unknown,
  token: string | null = mayaToken,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return mcpRoute.POST(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  token: string | null = mayaToken,
) {
  const response = await rpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    token,
  );
  const body = await json<{
    result: { content: Array<{ type: string; text: string }>; structuredContent?: unknown; isError?: boolean };
  }>(response);
  return { status: response.status, result: body.result };
}

beforeAll(async () => {
  test = createTestDatabase({ label: 'api-mcp' });
  db = test.db;
  household = await buildHouseholdFixture(db);
  syncAddonRegistryAndSearch(db);
  // Make the reference add-on available everywhere so set_addon_values works.
  db.prepare("UPDATE addons SET mode = 'always' WHERE identifier = 'assignee'").run();
  updateApplicationSettings(db, { mcpEnabled: true });
  mayaToken = createMcpToken(db, household.maya.id, 'Claude Desktop').token;
  alexToken = createMcpToken(db, household.alex.id, 'Open WebUI').token;
});

beforeEach(() => {
  resetRequestContext();
});

afterAll(() => {
  test.cleanup();
});

describe('opt-in and authentication', () => {
  it('is disabled by default and refuses every token while off', async () => {
    updateApplicationSettings(db, { mcpEnabled: false });
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(response.status).toBe(403);
    const body = await json<{ error: { code: string } }>(response);
    expect(body.error.code).toBe('mcp_disabled');
    updateApplicationSettings(db, { mcpEnabled: true });
  });

  it('rejects a missing or unknown bearer token', async () => {
    const missing = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, null);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer');

    const unknown = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'kapo_mcp_nope');
    expect(unknown.status).toBe(401);
  });

  it('rejects a revoked token immediately', async () => {
    const created = createMcpToken(db, household.jules.id, 'Temporary');
    expect(revokeMcpToken(db, household.jules.id, created.summary.id)).toBe(true);
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, created.token);
    expect(response.status).toBe(401);
  });

  it('does not let one user revoke another user’s token', async () => {
    const created = createMcpToken(db, household.jules.id, 'Jules only');
    signIn(db, household.maya.id);
    const response = await tokenRoute.DELETE(
      request(`/api/me/mcp-tokens/${created.summary.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: created.summary.id }) },
    );
    expect(response.status).toBe(404);
    const ping = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, created.token);
    expect(ping.status).toBe(200);
  });
});

describe('protocol', () => {
  it('initializes with the requested protocol version and tool capability', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test' } },
    });
    expect(response.status).toBe(200);
    const body = await json<{
      result: {
        protocolVersion: string;
        capabilities: { tools: unknown };
        serverInfo: { name: string };
        instructions: string;
      };
    }>(response);
    expect(body.result.protocolVersion).toBe('2025-03-26');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe('kapo');
    expect(body.result.instructions).toContain('history');
  });

  it('accepts notifications without a JSON-RPC response', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(response.status).toBe(202);
  });

  it('lists every tool with an input schema and no handler leakage', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const body = await json<{
      result: { tools: Array<Record<string, unknown>> };
    }>(response);
    const names = body.result.tools.map((tool) => tool.name);
    expect(names).toEqual([
      'whoami',
      'search_projects',
      'get_project',
      'list_inbox',
      'list_children',
      'get_workflow',
      'get_activity',
      'create_project',
      'update_project',
      'release_inbox',
      'set_addon_values',
    ]);
    for (const tool of body.result.tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.handler).toBeUndefined();
    }
  });

  it('returns method-not-found and unknown-tool errors', async () => {
    const method = await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    const methodBody = await json<{ error: { code: number } }>(method);
    expect(methodBody.error.code).toBe(-32601);

    const tool = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'delete_everything' },
    });
    const toolBody = await json<{ error: { code: number } }>(tool);
    expect(toolBody.error.code).toBe(-32602);
  });
});

describe('tools', () => {
  it('identifies the token owner and its label', async () => {
    const { result } = await callTool('whoami');
    const payload = result.structuredContent as {
      username: string;
      appRole: string;
      canWrite: boolean;
      mcp: { tokenLabel: string };
    };
    expect(payload.username).toBe('maya');
    expect(payload.appRole).toBe('user');
    expect(payload.canWrite).toBe(true);
    expect(payload.mcp.tokenLabel).toBe('Claude Desktop');
  });

  it('searches only projects the token owner may read', async () => {
    const allowed = await callTool('search_projects', { query: 'renovate' });
    const allowedPayload = allowed.result.structuredContent as {
      results: Array<{ projectId: string; title: string }>;
    };
    expect(allowedPayload.results.some((item) => item.projectId === household.renovate.id)).toBe(true);

    const denied = await callTool('search_projects', { query: 'weekend' });
    const deniedPayload = denied.result.structuredContent as { results: unknown[] };
    expect(deniedPayload.results).toEqual([]);
  });

  it('reads a project with add-on definitions and values', async () => {
    const { result } = await callTool('get_project', { projectId: household.renovate.id });
    const payload = result.structuredContent as {
      project: { title: string; inbox: boolean; yourRole: string };
      addons: Array<{ identifier: string; mode: string; available: boolean }>;
    };
    expect(payload.project.title).toBe('Renovate basement');
    expect(payload.project.inbox).toBe(true);
    expect(payload.project.yourRole).toBe('admin');
    expect(payload.addons.some((addon) => addon.identifier === 'assignee')).toBe(true);
  });

  it('returns tool errors instead of crashes for unreadable projects', async () => {
    const { result } = await callTool('get_project', { projectId: household.personal.id });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
  });

  it('creates a project and records MCP provenance on both audits', async () => {
    const { result } = await callTool('create_project', {
      parentId: household.home.id,
      title: 'Fix the radiator',
    });
    const created = result.structuredContent as { project: { projectId: string; title: string } };
    expect(created.project.title).toBe('Fix the radiator');

    const rows = db
      .prepare(
        `SELECT action, via_channel, via_agent FROM audit_events
          WHERE project_id IN (?, ?) ORDER BY action`,
      )
      .all(created.project.projectId, household.home.id) as Array<{
        action: string;
        via_channel: string | null;
        via_agent: string | null;
      }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.via_channel).toBe('mcp');
      expect(row.via_agent).toBe('Claude Desktop');
    }

    const activity = listActivity(db, created.project.projectId);
    expect(activity.events[0]?.via).toEqual({ channel: 'mcp', agent: 'Claude Desktop' });
  });

  it('updates a title and moves a project out of the Inbox', async () => {
    const renamed = await callTool('update_project', {
      projectId: household.renovate.id,
      title: 'Renovate the basement',
    });
    expect(renamed.result.isError).toBeUndefined();

    const done = getFinishStatus(db, household.home.id);
    const moved = await callTool('update_project', {
      projectId: household.renovate.id,
      statusId: done.id,
    });
    expect(moved.result.isError).toBeUndefined();

    const row = db
      .prepare('SELECT inbox, status_id, title FROM projects WHERE id = ?')
      .get(household.renovate.id) as { inbox: number; status_id: string; title: string };
    expect(row.inbox).toBe(0);
    expect(row.status_id).toBe(done.id);
    expect(row.title).toBe('Renovate the basement');
  });

  it('releases a project from the Inbox', async () => {
    const { result } = await callTool('release_inbox', {
      projectId: household.paintHallway.id,
    });
    expect(result.isError).toBeUndefined();
    const row = db
      .prepare('SELECT inbox FROM projects WHERE id = ?')
      .get(household.paintHallway.id) as { inbox: number };
    expect(row.inbox).toBe(0);
  });

  it('writes add-on values through the generic add-on path', async () => {
    const { result } = await callTool('set_addon_values', {
      projectId: household.renovate.id,
      identifier: 'assignee',
      values: { assignee: household.jules.id },
    });
    expect(result.isError).toBeUndefined();

    const row = db
      .prepare('SELECT addon_data FROM projects WHERE id = ?')
      .get(household.renovate.id) as { addon_data: string };
    const values = (JSON.parse(row.addon_data) as { assignee?: { assignee?: string } }).assignee;
    expect(values?.assignee).toBe(household.jules.id);

    const audit = db
      .prepare(
        `SELECT via_channel, via_agent FROM audit_events
          WHERE project_id = ? AND action = 'project.addon_value_changed'
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(household.renovate.id) as { via_channel: string; via_agent: string };
    expect(audit).toEqual({ via_channel: 'mcp', via_agent: 'Claude Desktop' });
  });

  it('enforces role permissions for a viewer token', async () => {
    const { result } = await callTool(
      'create_project',
      { parentId: household.home.id, title: 'Viewer attempt' },
      alexToken,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.toLowerCase()).toContain('edit access');
  });

  it('keeps ordinary web writes free of MCP provenance', async () => {
    updateProject(
      db,
      { id: household.maya.id, appRole: 'user', showArchived: false },
      household.renovate.id,
      { title: 'Renovate basement' },
    );
    const row = db
      .prepare(
        `SELECT via_channel, via_agent FROM audit_events
          WHERE project_id = ? AND action = 'project.renamed'
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(household.renovate.id) as { via_channel: string | null; via_agent: string | null };
    expect(row).toEqual({ via_channel: null, via_agent: null });
  });
});

describe('dashboard', () => {
  it('marks MCP-originated recent changes with their agent label', async () => {
    // A distinct title guarantees a new audit row (updates to the same title
    // are no-ops and write nothing).
    await callTool('update_project', {
      projectId: household.renovate.id,
      title: 'Renovate the cellar',
    });
    signIn(db, household.maya.id);
    const response = await dashboardRoute.GET(
      request('/api/dashboard?widget=recent'),
      EMPTY_CONTEXT,
    );
    expect(response.status).toBe(200);
    const payload = await json<{
      widget: {
        items: Array<{ projectId: string; action: string; via: unknown }>;
      };
    }>(response);
    const item = payload.widget.items.find(
      (entry) =>
        entry.projectId === household.renovate.id &&
        entry.action === 'project.renamed',
    );
    expect(item?.via).toEqual({ channel: 'mcp', agent: 'Claude Desktop' });
    signOut();
  });
});

describe('token management routes', () => {
  it('creates, lists and revokes a personal token through the API', async () => {
    signIn(db, household.maya.id);
    const createResponse = await tokensRoute.POST(
      request('/api/me/mcp-tokens', { method: 'POST', body: { label: 'Local llama.cpp' } }),
      EMPTY_CONTEXT,
    );
    expect(createResponse.status).toBe(201);
    const created = await json<{
      token: string;
      summary: { id: string; label: string };
    }>(createResponse);
    expect(created.token.startsWith('kapo_mcp_')).toBe(true);

    const listResponse = await tokensRoute.GET(
      request('/api/me/mcp-tokens'),
      EMPTY_CONTEXT,
    );
    const listed = await json<{ enabled: boolean; tokens: Array<{ id: string }> }>(listResponse);
    expect(listed.enabled).toBe(true);
    expect(listed.tokens.some((token) => token.id === created.summary.id)).toBe(true);

    const revokeResponse = await tokenRoute.DELETE(
      request(`/api/me/mcp-tokens/${created.summary.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: created.summary.id }) },
    );
    expect(revokeResponse.status).toBe(200);

    const ping = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, created.token);
    expect(ping.status).toBe(401);
  });

  it('refuses to create a token while MCP access is disabled', async () => {
    signIn(db, household.maya.id);
    updateApplicationSettings(db, { mcpEnabled: false });
    const response = await tokensRoute.POST(
      request('/api/me/mcp-tokens', { method: 'POST', body: { label: 'Should fail' } }),
      EMPTY_CONTEXT,
    );
    expect(response.status).toBe(403);
    updateApplicationSettings(db, { mcpEnabled: true });
  });

  it('validates the token label', async () => {
    signIn(db, household.maya.id);
    const response = await tokensRoute.POST(
      request('/api/me/mcp-tokens', { method: 'POST', body: { label: '   ' } }),
      EMPTY_CONTEXT,
    );
    expect(response.status).toBe(422);
    signOut();
  });
});
