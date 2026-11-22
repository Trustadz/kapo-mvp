import type {
  AddonDefinition,
  AddonFieldValue,
  AddonValidationIssue,
  AddonWidgetContext,
  AddonWidgetItem,
} from '../types';

/**
 * Assignee — the reference add-on from docs/add-ons.md §12.
 *
 * Zero or one household member per project. This module owns the definition,
 * its hooks and its dashboard loader; it never imports core domain modules and
 * no core module imports this file by name. Everything is registered through
 * the generic manifest (`src/server/addons/index.ts`).
 */

function validateAssignee(value: unknown): AddonValidationIssue | null {
  if (value === null || value === undefined) return null; // zero assignee is valid unless required
  if (typeof value !== 'string' || !value.trim()) {
    return { field: 'assignee', message: 'Choose a valid assignee.' };
  }
  return null;
}

function assigneeValues(values: Record<string, AddonFieldValue>): unknown {
  return values.assignee;
}

export const assigneeAddon: AddonDefinition = {
  identifier: 'assignee',
  name: 'Assignee',
  description: 'Assign a project to one household member.',
  version: '1.0.0',
  defaultMode: 'always',
  fields: [
    {
      key: 'assignee',
      label: 'Assigned to',
      type: 'user',
      required: false,
      description: 'One person responsible for this project.',
    },
  ],
  // User ids are opaque and name text is identity data; filtering by assignee
  // is a dashboard query, not a full-text search field (docs/add-ons.md §12.4).
  searchFields: [],
  compactRenderer: 'assignee.compact',
  hooks: {
    validate({ values }) {
      const issue = validateAssignee(assigneeValues(values));
      return issue ? [issue] : [];
    },
    beforeLeaveInbox({ values, mode }) {
      // Both hooks run on every Inbox exit (beforeLeaveInbox first). The
      // global mode is the only requirement source in v1.
      if (mode === 'required' && (values.assignee === null || values.assignee === undefined)) {
        return [
          { field: 'assignee', message: 'Choose an assignee before leaving the Inbox.' },
        ];
      }
      const issue = validateAssignee(assigneeValues(values));
      return issue ? [issue] : [];
    },
  },
  dashboardWidgets: [
    {
      id: 'assignee.assigned_to_me',
      label: 'Assigned to me',
      description: 'Open projects assigned to you, grouped by parent.',
      load: (ctx) => loadAssignedToMe(ctx),
    },
  ],
};

/**
 * Read-only "Assigned to me" payload. There is no dashboard consumer for
 * add-on widgets yet (docs/add-ons.md §9); the loader is the contract that
 * bridge will call with a core permission-filtered context.
 */
function loadAssignedToMe(ctx: AddonWidgetContext): AddonWidgetItem[] {
  if (ctx.visibleProjectIds.length === 0) return [];
  const placeholders = ctx.visibleProjectIds.map(() => '?').join(',');
  const rows = ctx.query<{
    id: string;
    title: string;
    parent_title: string;
    status: string;
    inbox: number;
  }>(
    `SELECT p.id AS id, p.title AS title, parent.title AS parent_title,
            s.name AS status, p.inbox AS inbox
       FROM projects p
       JOIN projects parent ON parent.id = p.parent_id
       JOIN statuses s ON s.id = p.status_id
      WHERE p.id IN (${placeholders})
        AND p.trashed_at IS NULL
        AND s.is_finish = 0
        AND json_extract(p.addon_data, '$.assignee.assignee') = ?
      ORDER BY parent.title COLLATE NOCASE, p.priority
      LIMIT 5`,
    [...ctx.visibleProjectIds, ctx.viewerId],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.title,
    href: `/p/${row.id}`,
    meta: `${row.parent_title} · ${row.status}${row.inbox ? ' · Inbox' : ''}`,
  }));
}
