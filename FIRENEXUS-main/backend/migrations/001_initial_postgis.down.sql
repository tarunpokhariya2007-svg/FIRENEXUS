DROP TABLE IF EXISTS harmonized_observations;
DROP TABLE IF EXISTS observation_matches;
DROP TABLE IF EXISTS harmonization_jobs;
DROP TABLE IF EXISTS acquisition_downloads;
DROP TABLE IF EXISTS acquisition_chunks;
DROP TABLE IF EXISTS acquisition_jobs;
DROP TABLE IF EXISTS data_quality_reports;
DROP TABLE IF EXISTS fire_observations;
DROP TABLE IF EXISTS datasets;
-- Keep the PostGIS extension: it may be managed/shared by the Aiven service.
