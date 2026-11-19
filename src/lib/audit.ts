/**
 * Audit event vocabulary shared by the domain, API and UI layers.
 *
 * `audit_events.action` stores one of these values. Field-level changes set
 * `field`, `old_value` and `new_value`; child lifecycle events set `target_id`.
 */

export const AUDIT_ACTIONS = {
  projectCreated: 'project.created',
  projectRenamed: 'project.renamed',
  projectStatusChanged: 'project.status_changed',
  projectArchived: 'project.archived',
  projectUnarchived: 'project.unarchived',
  projectTrashed: 'project.trashed',
  projectRestored: 'project.restored',
  projectMoved: 'project.moved',
  projectPriorityChanged: 'project.priority_changed',
  projectInboxReleased: 'project.inbox_released',
  childCreated: 'project.child_created',
  childTrashed: 'project.child_trashed',
  workflowUpdated: 'workflow.updated',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_FIELDS = {
  title: 'title',
  status: 'status',
  parent: 'parent',
  priority: 'priority',
  archived: 'archived',
} as const;

export type AuditField = (typeof AUDIT_FIELDS)[keyof typeof AUDIT_FIELDS];
