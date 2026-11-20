-- Every project owns the workflow for its children, including projects that do
-- not have children yet. Older databases created a workflow only once a project
-- received its first child, which left leaf projects unable to accept a child.
-- Backfill the default To do / Done workflow for every project with no statuses.

DROP TABLE IF EXISTS _missing_project_workflows;
CREATE TEMP TABLE _missing_project_workflows AS
  SELECT p.id AS id
    FROM projects p
   WHERE NOT EXISTS (SELECT 1 FROM statuses s WHERE s.parent_id = p.id);

INSERT INTO statuses (id, parent_id, name, position, is_start, is_finish)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
    '8' || substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  p.id,
  v.name,
  v.position,
  v.is_start,
  v.is_finish
FROM _missing_project_workflows p
CROSS JOIN (
  SELECT 'To do' AS name, 0 AS position, 1 AS is_start, 0 AS is_finish
  UNION ALL
  SELECT 'Done', 1, 0, 1
) v;

DROP TABLE _missing_project_workflows;
