-- Issue #53: every project now has one app-wide priority position shared by all
-- users. Existing `priority` values were only unique within a parent, so they
-- cannot be compared across the tree. Renumber every project into one
-- contiguous global sequence, preserving each parent's current ordering.
--
-- Two phases:
--   1. offset every value out of the target 0..N-1 range. The immediate
--      UNIQUE(parent_id, priority) constraint otherwise blocks some swaps.
--   2. assign ROW_NUMBER() - 1 ordered by the old priority and seq.
--
-- On a fresh database (migrations run before seed) both statements touch no
-- rows, so this is a no-op.

UPDATE projects SET priority = priority + 1000000;

DROP TABLE IF EXISTS _global_project_priority;
CREATE TEMP TABLE _global_project_priority AS
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY priority ASC, seq ASC) - 1 AS priority
    FROM projects;

UPDATE projects
   SET priority = (
     SELECT ordered.priority
       FROM _global_project_priority ordered
      WHERE ordered.id = projects.id
   );

DROP TABLE _global_project_priority;
