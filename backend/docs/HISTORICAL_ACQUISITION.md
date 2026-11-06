# FIRENEXUS historical FIRMS acquisition

## Study scope

The planning window is **2022–2026**, beginning **2022-01-01**. Its selectable end is the `max_date` returned by NASA FIRMS for the selected Standard Processing (SP) source when availability is refreshed. FIRENEXUS does not assume that December 31, 2026, or the current date, is available. MODIS and each VIIRS product can report different coverage endpoints.

Products queried through NASA FIRMS are:

| Product | FIRMS source ID | Platform metadata |
| --- | --- | --- |
| MODIS Standard Processing | `MODIS_SP` | Terra and Aqua remain distinct in each row's satellite metadata |
| VIIRS Suomi-NPP 375 m Standard Processing | `VIIRS_SNPP_SP` | Suomi-NPP |
| VIIRS NOAA-20 375 m Standard Processing | `VIIRS_NOAA20_SP` | NOAA-20 |
| VIIRS NOAA-21 375 m Standard Processing | `VIIRS_NOAA21_SP` | NOAA-21 |

Study regions are Amazon Basin, California, Southeastern Australia, and Uttarakhand. Each region's bounding box is used for the FIRMS Area API request. A configured GeoJSON Polygon or MultiPolygon is applied as an exact point-in-polygon filter after download. The built-in demonstration regions currently have approximate bounding boxes and no authoritative polygons; acquisitions for them are labeled bbox-only.

## Availability and dates

`GET /api/acquisition/availability?refresh=true` calls NASA's `data_availability` CSV endpoint using the backend-only `FIRMS_MAP_KEY`, and persists the returned `min_date` / `max_date` in `FIRENEXUS_DATA_DIR/firms_acquisition/availability_manifest.json`. Each source is evaluated separately. If the key is absent or NASA cannot be queried, coverage remains unverified and acquisition cannot start. No date values are inferred or backfilled.

The date picker enforces the 2022-01-01 study start and caps its end date at the selected product's verified `max_date`. The displayed Area API request estimate counts five-day chunks that overlap the source's reported min/max extent. It does not estimate detections and does not imply that every date in that extent has complete coverage or observations. Dates before a source's `min_date` are recorded as unavailable product coverage.

## Acquisition, provenance, and status

The FIRMS Area API accepts a maximum of five dates per request. Jobs are user-started, resumable, rate-limited, and paused between chunks. Before Area API requests, the backend checks the live MAP_KEY transaction status and retains a transaction safety margin. Transient errors use bounded exponential retry.

Raw response CSV bytes are preserved under `firms_acquisition/raw/{region_id}/{source_id}/{year}/`. SHA-256 checksums and HTTP content lengths are checked; saved checksums are recalculated before a cached download is reused. A SQLite manifest persists source, region, period, original stored filename, download timestamp, checksum, satellite, product version, record count, and status. Parsed/imported observations use the existing chunked ingestion and indexed SQLite registry.

Statuses distinguish pending/not-yet-downloaded work, failed chunks, unavailable product coverage, valid CSV responses with zero detections, and responses containing records. Zero detections are not treated as unavailable coverage. No rows or missing dates are synthesized.

## NASA bulk archive note

NASA's Archive Download service is an authenticated order flow with email delivery instructions; this manager currently automates the Area API path rather than submitting bulk archive orders. Large historical requests can therefore require many bounded requests. No historical acquisition runs automatically at startup.
