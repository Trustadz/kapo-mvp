import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { AuthUser, ProjectRole } from '@/lib/types';
import type { ProjectAddonEditorItem } from '@/lib/addons';
import type { ActivityEvent } from '@/lib/projects';
import {
  getProjectPageData,
  updateProject,
  createProject,
} from '../domain/projects';
import { listInbox, releaseInboxProject } from '../domain/inbox';
import { searchProjects } from '../domain/search';
import { listActivity } from '../domain/audit';
import { writeAddonValues } from '../domain/project-addons';
import {
  DomainError,
  canReadProject,
  loadAccessContext,
  type AccessUser,
} from '../domain/permissions';

/**
 * MCP tool surface (core capability, opt-in).
 *
 * Design rules, mirroring `docs/add-ons.md`:
 *  - Tools are *generic verbs over the domain*; there is no per-add-on tool.
 *    Add-on data appears through `get_project` (resolved availability + values)
 *    and is written through `set_addon_values`, which runs the same validation,
 *    audit and FTS maintenance as the web editor.
 *  - Every handler runs as the token's owning user. Permission checks are the
 *    domain's, not this layer's, and no handler may widen them.
 *  - Handlers return plain JSON-serialisable data. Failures are domain errors;
 *    the protocol layer turns them into `isError` tool results so the model can
 *    explain the problem and retry.
 */

export class McpToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolInputError';
  }
}

export interface McpToolContext {
  db: BetterSqliteDatabase;
  user: AuthUser;
  /** The same access user the web routes build, with `via` provenance set. */
  accessUser: AccessUser;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(context: McpToolContext, args: Record<string, unknown>): unknown;
}

const PROJECT_ID_DESCRIPTION =
  'Kapo project id — the UUID from get_project, list_children or search_projects.';

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new McpToolInputError(`"${key}" must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new McpToolInputError(`"${key}" must be a non-empty string when provided.`);
  }
  return value.trim();
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new McpToolInputError(`"${key}" must be true or false.`);
  }
  return value;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new McpToolInputError(`"${key}" must be a number.`);
  }
  return value;
}

function requireRecord(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new McpToolInputError(`"${key}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function statusSummary(status: { id: string; name: string; position: number; isStart: boolean; isFinish: boolean }) {
  return {
    id: status.id,
    name: status.name,
    position: status.position,
    isStart: status.isStart,
    isFinish: status.isFinish,
  };
}

function cardSummary(card: {
  id: string;
  title: string;
  statusId: string | null;
  statusName: string | null;
  inbox: boolean;
  archived: boolean;
  trashed: boolean;
  parentId: string | null;
}) {
  return {
    // The opaque UUID is the only project handle the assistant gets. Kapo's
    // user-facing display number and sibling priority stay internal.
    projectId: card.id,
    title: card.title,
    statusId: card.statusId,
    statusName: card.statusName,
    inbox: card.inbox,
    archived: card.archived,
    trashed: card.trashed,
    parentId: card.parentId,
  };
}

function addonSummary(item: ProjectAddonEditorItem) {
  const display: Record<string, string | null> = {};
  for (const field of item.fields) {
    const value = item.values[field.key];
    if (value === undefined || value === null) {
      display[field.key] = null;
    } else if (field.type === 'select') {
      display[field.key] = field.options?.find((option) => option.value === value)?.label ?? String(value);
    } else if (field.type === 'user') {
      display[field.key] =
        item.userOptions?.find((option) => option.value === value)?.label ?? String(value);
    } else {
      display[field.key] = String(value);
    }
  }
  return {
    identifier: item.identifier,
    name: item.name,
    description: item.description,
    mode: item.mode,
    required: item.required,
    fields: item.fields,
    values: item.values,
    displayValues: display,
    userOptions: item.userOptions,
  };
}

function activitySummary(event: ActivityEvent) {
  // Sibling priority is a calculated internal order, never a user-facing field:
  // the web history renders "moved earlier/later" without the numbers. The
  // assistant gets the same treatment (the action still says what happened).
  const isPriority = event.field === 'priority';
  // Add-on changes store their raw field keys and values in `detail`; the
  // human label and display values are already in `field`/oldValue/newValue.
  const isAddonValue = event.action === 'project.addon_value_changed';
  return {
    id: event.id,
    action: event.action,
    field: isPriority ? null : event.field,
    oldValue: isPriority ? null : event.oldValue,
    newValue: isPriority ? null : event.newValue,
    detail: isAddonValue ? null : event.detail,
    actor: event.actor ? { username: event.actor.username } : null,
    via: event.via,
    createdAt: event.createdAt,
    target: event.target,
  };
}

function requirePage(context: McpToolContext, projectId: string) {
  const page = getProjectPageData(context.db, context.accessUser, projectId);
  if (!page) {
    throw new DomainError(404, 'not_found', 'Project not found.');
  }
  return page;
}

/** Effective role names are surfaced so the model can explain write failures. */
function describeRole(role: ProjectRole): string {
  return role;
}

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'whoami',
    title: 'Who am I',
    description:
      'Return the signed-in Kapo user for this MCP token, the application role, and the token label that history will show. Call this first to confirm which account and permissions the assistant is using.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (context) => ({
      id: context.user.id,
      username: context.user.username,
      appRole: context.user.appRole,
      showArchived: context.accessUser.showArchived,
      canWrite: context.user.appRole !== 'viewer',
      mcp: {
        tokenLabel: context.accessUser.via?.agent ?? null,
      },
    }),
  },
  {
    name: 'search_projects',
    title: 'Search projects',
    description:
      'Full-text search over project titles and searchable add-on text. Results are limited to projects the token owner may read; trashed projects never appear and archived projects follow the user\u2019s "show archived" setting.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search words. Prefix matching is used per word.' },
        limit: { type: 'number', description: 'Maximum results (1–100, default 25).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: (context, args) => {
      const query = requireString(args, 'query');
      const limit = optionalNumber(args, 'limit');
      const results = searchProjects(context.db, context.accessUser, query, {
        limit: limit === undefined ? 25 : Math.trunc(limit),
      });
      // Normalise the core's `id` to `projectId`, matching every other tool.
      return {
        results: results.map((item) => ({
          projectId: item.id,
          title: item.title,
          parentTitle: item.parentTitle,
          directAccess: item.directAccess,
          archived: item.archived,
          statusName: item.statusName,
          match: item.match,
        })),
      };
    },
  },
  {
    name: 'get_project',
    title: 'Get project',
    description:
      'Read one project with its parent, breadcrumb, workflow statuses, direct children, available add-on fields and values, and the most recent history. Use this before updating a project so you have valid status ids and add-on field keys.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: PROJECT_ID_DESCRIPTION },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: (context, args) => {
      const projectId = requireString(args, 'projectId');
      const page = requirePage(context, projectId);
      return {
        project: {
          projectId: page.project.id,
          title: page.project.title,
          statusId: page.project.statusId,
          statusName: page.project.statusName,
          parent: page.project.parent,
          breadcrumb: page.breadcrumb,
          inbox: page.project.inbox,
          archived: page.project.archived,
          trashed: page.project.trashed,
          favorite: page.project.favorite,
          reporter: page.project.reporter,
          createdBy: page.project.createdBy,
          createdAt: page.project.createdAt,
          updatedAt: page.project.updatedAt,
          isRoot: page.project.isRoot,
          yourRole: describeRole(page.project.effectiveRole),
        },
        statusesForChildren: page.statuses.map(statusSummary),
        ownWorkflow: page.parentStatuses.map(statusSummary),
        children: page.children.map(cardSummary),
        addons: page.addons.items.map(addonSummary),
        canEditAddons: page.addons.canEdit,
        addonsReadOnlyReason: page.addons.readOnlyReason,
        recentActivity: page.activity.events.slice(0, 5).map(activitySummary),
      };
    },
  },
  {
    name: 'list_inbox',
    title: 'List Inbox',
    description:
      'List the project Inbox visible to the token owner, newest first, with parent context and whether each item can be released. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (context) => ({
      items: listInbox(context.db, context.accessUser).map((item) => ({
        project: cardSummary(item.project),
        parentTitle: item.parentTitle,
        startStatusId: item.startStatusId,
        startStatusName: item.startStatusName,
        canRelease: item.canRelease,
      })),
    }),
  },
  {
    name: 'list_children',
    title: 'List children',
    description:
      'List the direct children of a project. Omit projectId to list the children of Root (the top level of the tree). Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Parent project id. Omit to use Root.',
        },
      },
      additionalProperties: false,
    },
    handler: (context, args) => {
      const requested = optionalString(args, 'projectId');
      let projectId = requested;
      if (!projectId) {
        const access = loadAccessContext(context.db, context.accessUser);
        if (!access.rootId) {
          throw new DomainError(404, 'not_found', 'This installation has no Root project yet.');
        }
        projectId = access.rootId;
      }
      const page = requirePage(context, projectId);
      return {
        parent: {
          projectId: page.project.id,
          title: page.project.title,
        },
        children: page.children.map(cardSummary),
        statusesForChildren: page.statuses.map(statusSummary),
      };
    },
  },
  {
    name: 'get_workflow',
    title: 'Get workflow',
    description:
      'Read the status workflow a project defines for its children and the workflow that owns the project\u2019s own status. Use the ids when changing status or creating children.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: PROJECT_ID_DESCRIPTION },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: (context, args) => {
      const page = requirePage(context, requireString(args, 'projectId'));
      return {
        project: { projectId: page.project.id, title: page.project.title },
        statusesForChildren: page.statuses.map(statusSummary),
        ownWorkflow: page.parentStatuses.map(statusSummary),
      };
    },
  },
  {
    name: 'get_activity',
    title: 'Get activity',
    description:
      'Read a page of a project\u2019s history, newest first. Each event names the human actor and, when the change came through MCP, the agent label (the `via` field).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: PROJECT_ID_DESCRIPTION },
        limit: { type: 'number', description: 'Events per page (1–50, default 8).' },
        cursor: { type: 'string', description: 'nextCursor from the previous page.' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: (context, args) => {
      const projectId = requireString(args, 'projectId');
      const ctx = loadAccessContext(context.db, context.accessUser);
      if (!canReadProject(ctx, projectId)) {
        throw new DomainError(404, 'not_found', 'Project not found.');
      }
      const limit = optionalNumber(args, 'limit');
      const page = listActivity(context.db, projectId, {
        cursor: optionalString(args, 'cursor') ?? null,
        limit: limit === undefined ? undefined : Math.trunc(limit),
        canReadTarget: (targetId) => canReadProject(ctx, targetId),
        targetExists: (targetId) => ctx.projectById.has(targetId),
      });
      return {
        events: page.events.map(activitySummary),
        nextCursor: page.nextCursor,
      };
    },
  },
  {
    name: 'create_project',
    title: 'Create project',
    description:
      'Create a child project under a parent. It starts in the parent workflow\u2019s start status and enters the Inbox, exactly like quick capture in the web app. The parent must be writable by the token owner.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: 'Parent project id (Root is a valid parent).' },
        title: { type: 'string', description: 'Project title, 1–200 characters.' },
      },
      required: ['parentId', 'title'],
      additionalProperties: false,
    },
    handler: (context, args) => {
      const card = createProject(context.db, context.accessUser, {
        parentId: requireString(args, 'parentId'),
        title: requireString(args, 'title'),
      });
      return { project: cardSummary(card) };
    },
  },
  {
    name: 'update_project',
    title: 'Update project',
    description:
      'Rename a project, change its status, or archive/unarchive it. Changing status while the project is in the Inbox leaves the Inbox and runs required add-on validation, exactly like the web app. Trashed projects are read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: PROJECT_ID_DESCRIPTION },
        title: { type: 'string', description: 'New title, 1–200 characters.' },
        statusId: {
          type: 'string',
          description: 'Target status id from get_workflow (ownWorkflow or statusesForChildren, as appropriate).',
        },
        archived: { type: 'boolean', description: 'Archive or unarchive the project.' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: (context, args) => {
      const projectId = requireString(args, 'projectId');
      const input: { title?: string; statusId?: string; archived?: boolean } = {};
      const title = optionalString(args, 'title');
      const statusId = optionalString(args, 'statusId');
      const archived = optionalBoolean(args, 'archived');
      if (title !== undefined) input.title = title;
      if (statusId !== undefined) input.statusId = statusId;
      if (archived !== undefined) input.archived = archived;
      if (Object.keys(input).length === 0) {
        throw new McpToolInputError('Provide at least one of title, statusId or archived.');
      }
      const result = updateProject(context.db, context.accessUser, projectId, input);
      return { project: cardSummary(result.project) };
    },
  },
  {
    name: 'release_inbox',
    title: 'Release from Inbox',
    description:
      'Release a project from the Inbox without changing its start status. Runs required add-on validation; a blocked release returns the validation issues.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: PROJECT_ID_DESCRIPTION },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: (context, args) => {
      const card = releaseInboxProject(
        context.db,
        context.accessUser,
        requireString(args, 'projectId'),
      );
      return { project: cardSummary(card) };
    },
  },
  {
    name: 'set_addon_values',
    title: 'Set add-on values',
    description:
      'Write add-on field values for a project through the same validation, audit and search path as the web editor. Use the field keys and value shapes returned by get_project. Only available add-ons accept values; a disabled or unavailable add-on is rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: PROJECT_ID_DESCRIPTION },
        identifier: {
          type: 'string',
          description: 'Add-on identifier from get_project (for example "assignee").',
        },
        values: {
          type: 'object',
          description: 'Partial map of field key to value. Existing keys are merged, not replaced.',
          additionalProperties: true,
        },
      },
      required: ['projectId', 'identifier', 'values'],
      additionalProperties: false,
    },
    handler: (context, args) => {
      const projectId = requireString(args, 'projectId');
      const identifier = requireString(args, 'identifier');
      const values = requireRecord(args, 'values');
      const result = writeAddonValues(
        context.db,
        context.accessUser,
        projectId,
        identifier,
        values,
      );
      return {
        identifier: result.identifier,
        values: result.values,
        mode: result.mode,
        available: result.available,
      };
    },
  },
];

export function findTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}

/** Public metadata for `tools/list` (handlers are not serialisable). */
export function listToolMetadata() {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
