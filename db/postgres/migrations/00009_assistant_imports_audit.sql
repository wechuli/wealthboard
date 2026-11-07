-- +goose Up
-- Import batches group the records one statement, trade, or position import
-- created so they can be listed, reconciled, and rolled back together.
CREATE TABLE import_batches (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    kind TEXT NOT NULL,
    source TEXT,
    idempotency_key UUID,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'committed',
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    statement_date DATE,
    statement_balance_minor BIGINT,
    created_at TIMESTAMPTZ NOT NULL,
    rolled_back_at TIMESTAMPTZ,
    CONSTRAINT import_batches_user_id_unique UNIQUE (user_id, id),
    CONSTRAINT import_batches_user_idempotency_unique UNIQUE (user_id, idempotency_key),
    CONSTRAINT import_batches_account_fk FOREIGN KEY (user_id, account_id)
        REFERENCES accounts(user_id, id) ON DELETE CASCADE,
    CONSTRAINT import_batches_kind_check CHECK (kind IN ('transactions', 'trades', 'positions')),
    CONSTRAINT import_batches_status_check CHECK (status IN ('committed', 'rolled_back')),
    CONSTRAINT import_batches_statement_check CHECK (
        (statement_date IS NULL) = (statement_balance_minor IS NULL)
    ),
    CONSTRAINT import_batches_summary_check CHECK (jsonb_typeof(summary) = 'object')
);

CREATE INDEX import_batches_user_account_created_idx
    ON import_batches (user_id, account_id, created_at DESC);

-- cash_snapshot_minor marks a position-account cash adjustment as an absolute
-- observation: its amount is recalculated so cash equals this value on its date.
ALTER TABLE transactions
    ADD COLUMN import_batch_id UUID,
    ADD COLUMN cash_snapshot_minor BIGINT,
    ADD CONSTRAINT transactions_import_batch_fk FOREIGN KEY (user_id, import_batch_id)
        REFERENCES import_batches(user_id, id) ON DELETE SET NULL (import_batch_id),
    ADD CONSTRAINT transactions_cash_snapshot_check CHECK (
        cash_snapshot_minor IS NULL OR type = 'manual_adjustment'
    );

CREATE INDEX transactions_user_import_batch_idx
    ON transactions (user_id, import_batch_id) WHERE import_batch_id IS NOT NULL;

-- snapshot_quantity marks a quantity adjustment as an absolute holding observation:
-- its quantity is recalculated so the position equals this value on its date.
ALTER TABLE position_events
    ADD COLUMN import_batch_id UUID,
    ADD COLUMN snapshot_quantity NUMERIC,
    ADD CONSTRAINT position_events_import_batch_fk FOREIGN KEY (user_id, import_batch_id)
        REFERENCES import_batches(user_id, id) ON DELETE SET NULL (import_batch_id),
    ADD CONSTRAINT position_events_snapshot_check CHECK (
        snapshot_quantity IS NULL OR (type = 'quantity_adjustment' AND snapshot_quantity >= 0)
    );

CREATE INDEX position_events_user_import_batch_idx
    ON position_events (user_id, import_batch_id) WHERE import_batch_id IS NOT NULL;

-- Financial changes made through the MCP endpoint. Record IDs only; no amounts,
-- descriptions, or other submitted values. No foreign keys, so entries outlive
-- the records they describe.
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    client TEXT,
    tool TEXT NOT NULL,
    action TEXT NOT NULL,
    record_type TEXT NOT NULL,
    record_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    account_id UUID,
    import_batch_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT audit_events_record_ids_check CHECK (jsonb_typeof(record_ids) = 'array')
);

CREATE INDEX audit_events_user_created_idx ON audit_events (user_id, created_at DESC);

-- +goose Down
DROP TABLE audit_events;
DROP INDEX position_events_user_import_batch_idx;
ALTER TABLE position_events
    DROP CONSTRAINT position_events_snapshot_check,
    DROP CONSTRAINT position_events_import_batch_fk,
    DROP COLUMN snapshot_quantity,
    DROP COLUMN import_batch_id;
DROP INDEX transactions_user_import_batch_idx;
ALTER TABLE transactions
    DROP CONSTRAINT transactions_cash_snapshot_check,
    DROP CONSTRAINT transactions_import_batch_fk,
    DROP COLUMN cash_snapshot_minor,
    DROP COLUMN import_batch_id;
DROP TABLE import_batches;
