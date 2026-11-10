CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE datasets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sensor TEXT NOT NULL CHECK (sensor IN ('MODIS','VIIRS')),
    satellite TEXT,
    source_filename TEXT,
    source_path TEXT,
    source_checksum_sha256 TEXT,
    record_count BIGINT NOT NULL DEFAULT 0,
    imported_at TIMESTAMPTZ,
    metadata JSONB NOT NULL,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_datasets_sensor ON datasets(sensor);

CREATE TABLE fire_observations (
    row_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    observation_id TEXT NOT NULL,
    nasa_source_id TEXT,
    sensor TEXT NOT NULL CHECK (sensor IN ('MODIS','VIIRS')),
    satellite TEXT,
    platform TEXT NOT NULL,
    acquisition_date DATE NOT NULL,
    acquisition_time_utc TIME NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    geom geometry(Point,4326) NOT NULL,
    frp DOUBLE PRECISION,
    confidence_numeric DOUBLE PRECISION,
    confidence_class TEXT,
    source_filename TEXT,
    source_row_number BIGINT,
    source_columns JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload JSONB NOT NULL,
    UNIQUE(dataset_id, observation_id)
);
CREATE INDEX idx_fire_observations_dataset ON fire_observations(dataset_id);
CREATE INDEX idx_fire_observations_sensor ON fire_observations(sensor);
CREATE INDEX idx_fire_observations_platform ON fire_observations(platform);
CREATE INDEX idx_fire_observations_date ON fire_observations(acquisition_date);
CREATE INDEX idx_fire_observations_acquired_at ON fire_observations(acquired_at);
CREATE INDEX idx_fire_observations_dataset_date ON fire_observations(dataset_id, acquisition_date);
CREATE INDEX idx_fire_observations_geom ON fire_observations USING GIST(geom);

CREATE TABLE data_quality_reports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    report JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quality_reports_dataset ON data_quality_reports(dataset_id, created_at DESC);

CREATE TABLE acquisition_jobs (
    id TEXT PRIMARY KEY,
    request_json JSONB NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    error TEXT,
    pause_requested BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_acquisition_jobs_status ON acquisition_jobs(status, created_at DESC);
CREATE TABLE acquisition_chunks (
    job_id TEXT NOT NULL REFERENCES acquisition_jobs(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    file_path TEXT,
    checksum TEXT,
    record_count BIGINT,
    original_filename TEXT,
    downloaded_at TIMESTAMPTZ,
    dataset_id TEXT REFERENCES datasets(id) ON DELETE SET NULL,
    product_version TEXT,
    satellite TEXT,
    error TEXT,
    PRIMARY KEY(job_id, start_date, end_date)
);
CREATE INDEX idx_acquisition_chunks_job_status ON acquisition_chunks(job_id,status);
CREATE TABLE acquisition_downloads (
    region_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    file_path TEXT NOT NULL,
    checksum TEXT NOT NULL,
    record_count BIGINT NOT NULL,
    original_filename TEXT NOT NULL,
    downloaded_at TIMESTAMPTZ NOT NULL,
    dataset_id TEXT REFERENCES datasets(id) ON DELETE SET NULL,
    product_version TEXT,
    satellite TEXT,
    status TEXT NOT NULL,
    PRIMARY KEY(region_id, source_id, start_date, end_date)
);
CREATE INDEX idx_acquisition_downloads_region_source ON acquisition_downloads(region_id,source_id);

CREATE TABLE harmonization_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    params JSONB NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE observation_matches (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES harmonization_jobs(id) ON DELETE CASCADE,
    modis_observation_row_id BIGINT REFERENCES fire_observations(row_id) ON DELETE CASCADE,
    viirs_observation_row_id BIGINT REFERENCES fire_observations(row_id) ON DELETE CASCADE,
    association_type TEXT NOT NULL,
    spatial_distance_m DOUBLE PRECISION,
    temporal_offset_minutes DOUBLE PRECISION,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(job_id, modis_observation_row_id, viirs_observation_row_id, association_type)
);
CREATE INDEX idx_observation_matches_job ON observation_matches(job_id);

CREATE TABLE harmonized_observations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES harmonization_jobs(id) ON DELETE CASCADE,
    cluster_id TEXT NOT NULL,
    status TEXT NOT NULL,
    geom geometry(Point,4326),
    details JSONB NOT NULL,
    UNIQUE(job_id, cluster_id)
);
CREATE INDEX idx_harmonized_observations_geom ON harmonized_observations USING GIST(geom);
CREATE INDEX idx_harmonized_observations_job ON harmonized_observations(job_id);
