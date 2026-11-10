CREATE TABLE dataset_imports (
    source_sha256 TEXT PRIMARY KEY CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    dataset_id TEXT UNIQUE REFERENCES datasets(id) ON DELETE SET NULL,
    provenance JSONB NOT NULL,
    import_status TEXT NOT NULL CHECK (import_status IN ('processing','completed','failed')),
    source_filename TEXT NOT NULL,
    source_path TEXT NOT NULL,
    expected_record_count BIGINT,
    total_input_rows BIGINT,
    parsed_rows BIGINT,
    rejected_rows BIGINT,
    duplicate_records BIGINT,
    quality_report JSONB,
    failure_code TEXT,
    failure_reason TEXT,
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CHECK (import_status <> 'completed' OR (dataset_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX idx_dataset_imports_status ON dataset_imports(import_status, started_at DESC);
