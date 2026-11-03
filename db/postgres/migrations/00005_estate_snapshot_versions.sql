-- +goose Up
-- Retained estate summaries were all stamped version 1. Number each plan's existing summaries
-- consecutively in the order they were generated; new summaries continue from the highest version.
UPDATE estate_plan_snapshots AS snapshot
SET version = ordered.position
FROM (
    SELECT id, row_number() OVER (PARTITION BY user_id, estate_plan_id ORDER BY generated_at, id) AS position
    FROM estate_plan_snapshots
) AS ordered
WHERE snapshot.id = ordered.id;

-- +goose Down
-- Versions are informational; restoring the previous constant keeps the schema compatible.
UPDATE estate_plan_snapshots SET version = 1;
